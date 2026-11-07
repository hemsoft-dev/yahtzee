import java.awt.*;
import java.awt.color.*;
import java.awt.image.*;
import java.lang.reflect.*;
import java.lang.management.*;
import java.net.*;
import java.nio.file.*;
import java.util.*;
import java.util.List;
import java.io.*;
public class Equivalent {
    static Class<?> original,candidate,rebuilt;
    static int cases=0;
    static long sink;
    static Class<?> load(String dir,String jar)throws Exception {
        URL[] urls=dir.equals("-")?new URL[]{
            Paths.get(jar).toUri().toURL()
        }
        :new URL[]{
            Paths.get(dir).toUri().toURL(),Paths.get(jar).toUri().toURL()
        }
        ;
        return new URLClassLoader(urls,ClassLoader.getPlatformClassLoader()).loadClass("com.github.romankh3.image.comparison.ImageComparison");
    }
    static Object call(Object o,String m,Class<?> t,Object v)throws Exception{
        return o.getClass().getMethod(m,t).invoke(o,v);
    }
    static Object get(Object o,String m)throws Exception{
        return o.getClass().getMethod(m).invoke(o);
    }
    static int[] pixels(BufferedImage x){
        return x==null?null:x.getRGB(0,0,x.getWidth(),x.getHeight(),null,0,x.getWidth());
    }
    static long hash(BufferedImage x){
        if(x==null)return 0;
        long h=7;
        for(int y=0;y<x.getHeight();y++)for(int z=0;z<x.getWidth();z++)h=h*31+x.getRGB(z,y);
        return h;
    }
    static String image(BufferedImage x,BufferedImage a,BufferedImage b){
        if(x==null)return "null";
        return (x==a?"a":x==b?"b":"copy")+":"+x.getType()+":"+x.getWidth()+":"+x.getHeight()+":"+Arrays.toString(pixels(x));
    }
    static String state(Object c)throws Exception{
        String s="";
        for(String n:new String[]{
            "counter","regionCount","matrix"
        }
        ){
            Field f=c.getClass().getDeclaredField(n);
            f.setAccessible(true);
            Object v=f.get(c);
            s+=n+":"+(v instanceof int[][]?Arrays.deepToString((int[][])v):v)+";";
        }
        return s;
    }
    static String result(Object r,BufferedImage a,BufferedImage b)throws Exception{
        String s=get(r,"getImageComparisonState")+":"+Float.floatToIntBits((Float)get(r,"getDifferencePercent"));
        float p=(Float)get(r,"getDifferencePercent");
        for(double t:new double[]{
            -1,0,Math.nextDown((double)p),p,Math.nextUp((double)p),1,100,Double.NaN
        }
        )s+=":"+(p<=t);
        for(String n:new String[]{
            "getExpected","getActual","getResult"
        }
        )s+="|"+image((BufferedImage)get(r,n),a,b);
        List<?> rs=(List<?>)get(r,"getRectangles");
        if(rs==null)return s+"|null";
        for(Object x:rs)s+="|"+get(x,"getMinPoint")+":"+get(x,"getMaxPoint");
        return s;
    }
    static String execute(Class<?> cls,BufferedImage a,BufferedImage b,int seed,boolean opts,int repeats)throws Exception{
        Object c=cls.getConstructor(BufferedImage.class,BufferedImage.class).newInstance(a,b);
        if(opts){
            call(c,"setThreshold",int.class,seed%7-1);
            call(c,"setPixelToleranceLevel",double.class,new double[]{
                0,.1,.5,.999,Double.NaN,-1
            }
            [Math.floorMod(seed,6)]);
            call(c,"setMinimalRectangleSize",Integer.class,seed%11==0?null:seed%5);
            call(c,"setAllowingPercentOfDifferentPixels",double.class,(double)(seed%5));
            if(seed%3==0)call(c,"setDrawExcludedRectangles",boolean.class,true);
            cls.getMethod("setDifferenceRectangleFilling",boolean.class,double.class).invoke(c,seed%2==0,20d);
            cls.getMethod("setExcludedRectangleFilling",boolean.class,double.class).invoke(c,true,30d);
        }
        String s="";
        for(int i=0;i<repeats;i++){
            try{
                Object r=cls.getMethod("compareImages").invoke(c);
                s+=result(r,a,b);
            }
            catch(InvocationTargetException e){
                Throwable t=e.getCause();
                s+="THROW:"+t.getClass().getName()+":"+(t instanceof StackOverflowError?"stack":t.getMessage());
            }
            s+="|STATE:"+state(c);
        }
        return s;
    }
    static void check(BufferedImage a,BufferedImage b,int seed,boolean opts)throws Exception{
        int[] ah=pixels(a),bh=pixels(b);
        String x=execute(original,a,b,seed,opts,2),z=execute(rebuilt,a,b,seed,opts,2),y=execute(candidate,a,b,seed,opts,2);
        if(!x.equals(z)||!x.equals(y))throw new AssertionError("DIFF case="+cases+" seed="+seed+" original="+x+" candidate="+y+" rebuilt="+z);
        if(!Arrays.equals(pixels(a),ah)||!Arrays.equals(pixels(b),bh))throw new AssertionError("input mutation");
        cases++;
    }
    static BufferedImage create(int type,int w,int h,int seed,boolean sub){
        BufferedImage a=new BufferedImage(w+(sub?9:0),h+(sub?7:0),type);
        Random r=new Random(seed);
        for(int y=0;y<a.getHeight();y++)for(int x=0;x<a.getWidth();x++)a.setRGB(x,y,r.nextInt());
        return sub?a.getSubimage(3,2,w,h):a;
    }
    static class Spy extends BufferedImage {
        final RuntimeException marker;
        final List<Integer> seen=new ArrayList<>();
        Spy(RuntimeException e){
            super(5,4,TYPE_INT_ARGB);
            marker=e;
        }
        public int getRGB(int x,int y){
            seen.add(y*5+x);
            if(x==2&&y==1&&marker!=null)throw marker;
            return super.getRGB(x,y);
        }
    }
    static void spies()throws Exception{
        RuntimeException marker=new IllegalStateException("owned-sentinel");
        for(Class<?> cls:new Class<?>[]{
            original,rebuilt,candidate
        }
        ){
            Spy a=new Spy(marker),b=new Spy(null);
            Object c=cls.getConstructor(BufferedImage.class,BufferedImage.class).newInstance(a,b);
            try{
                cls.getMethod("compareImages").invoke(c);
                throw new AssertionError("missing throw");
            }
            catch(InvocationTargetException e){
                if(e.getCause()!=marker)throw new AssertionError("exception identity");
            }
            if(!a.seen.equals(Arrays.asList(0,1,2,3,4,5,6,7))||!b.seen.equals(Arrays.asList(0,1,2,3,4,5,6)))throw new AssertionError("getter order");
        }
        cases++;
    }
    static void bench(String label,BufferedImage a,BufferedImage b)throws Exception{
        ThreadMXBean cpu=ManagementFactory.getThreadMXBean();
        for(int i=0;i<4;i++){
            execute(i%2==0?original:candidate,a,b,1,false,1);
        }
        for(int i=0;i<8;i++){
            boolean first=i%2==0;
            for(int j=0;j<2;j++){
                boolean base=(j==0)==first;
                long t=System.nanoTime(),p=cpu.getCurrentThreadCpuTime();
                String s=execute(base?original:candidate,a,b,1,false,1);
                long ns=System.nanoTime()-t,cn=cpu.getCurrentThreadCpuTime()-p;
                sink+=s.hashCode();
                System.out.printf(Locale.ROOT,"BENCH %s %d %s %.6f %.6f%n",label,i,base?"original":"candidate",ns/1e6,cn/1e6);
            }
        }
    }
    public static void main(String[]a)throws Exception {
        original=load("-",a[0]);
        rebuilt=load(a[1],a[0]);
        candidate=load(a[2],a[0]);
        for(int type=1;type<=13;type++)for(int seed=0;seed<16;seed++){
            BufferedImage x=create(type,19,17,seed,seed%2==0),y=create(type,19,17,seed+(seed%3==0?0:1),seed%2==0);
            check(x,y,seed,true);
        }
        for(int seed=0;seed<100;seed++){
            check(create(1+seed%13,1+seed%31,1+seed%23,seed,true),create(1+(seed+4)%13,1+seed%31,1+seed%23,seed+1,false),seed,false);
        }
        check(null,null,1,false);
        check(null,create(1,2,2,1,false),1,false);
        check(create(1,2,2,1,false),null,1,false);
        check(create(1,7,9,1,false),create(2,3,4,2,false),1,false);
        spies();
        // Alpha and exact predicate boundaries, including zero tolerance and alpha-only differences.
        for(int d=0;d<256;d++){
            BufferedImage x=new BufferedImage(2,2,2),y=new BufferedImage(2,2,2);
            y.setRGB(0,0,(d<<16)|0x80000000);
            check(x,y,d,true);
        }
        System.out.println("EQUIVALENCE_PASS cases="+cases);
        if(a.length>3)return;
        for(String mode:new String[]{
            "equal","one-region","336-regions","mixed-raster","subimage","alpha"
        }
        ){
            int type=mode.equals("alpha")?3:5;
            BufferedImage x=new BufferedImage(1032+(mode.equals("subimage")?10:0),1376+10,type),y=new BufferedImage(x.getWidth(),x.getHeight(),mode.equals("mixed-raster")?1:type);
            if(mode.equals("subimage")){
                x=x.getSubimage(3,2,1032,1376);
                y=y.getSubimage(3,2,1032,1376);
            }
            if(!mode.equals("equal")){
                int spacing=mode.equals("one-region")?2000:64;
                for(int yy=20;yy<1376;yy+=spacing)for(int xx=20;xx<1032;xx+=spacing)y.setRGB(xx,yy,-1);
            }
            bench(mode,x,y);
        }
        System.out.println("BENCH_PASS sink="+sink);
    }
}
