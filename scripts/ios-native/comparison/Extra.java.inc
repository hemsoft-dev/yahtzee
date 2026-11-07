import java.awt.*;
import java.awt.color.*;
import java.awt.image.*;
import java.lang.reflect.*;
import java.lang.management.*;
import java.nio.file.*;
import java.util.*;
import javax.imageio.*;
public class Extra extends Equivalent {
    static Object configured(Class<?> cls,BufferedImage a,BufferedImage b,java.io.File dest)throws Exception{
        Object c=cls.getConstructor(BufferedImage.class,BufferedImage.class,java.io.File.class).newInstance(a,b,dest);
        Class<?> rect=cls.getClassLoader().loadClass("com.github.romankh3.image.comparison.model.Rectangle");
        Object r=rect.getConstructor(int.class,int.class,int.class,int.class).newInstance(1,1,4,4);
        call(c,"setExcludedAreas",java.util.List.class,Arrays.asList(r));
        call(c,"setDrawExcludedRectangles",boolean.class,true);
        cls.getMethod("setDifferenceRectangleFilling",boolean.class,double.class).invoke(c,true,40d);
        return c;
    }
    static void outputControls()throws Exception{
        BufferedImage a=create(6,21,19,1,false),b=create(6,21,19,2,false);
        String golden=null;
        for(Class<?> cls:new Class<?>[]{
            original,rebuilt,candidate
        }
        ){
            Path d=Files.createTempDirectory(Paths.get(System.getProperty("study.dir")),"save-");
            Path file=d.resolve("image.png");
            Object c=configured(cls,a,b,file.toFile());
            Object r=cls.getMethod("compareImages").invoke(c);
            String value=result(r,a,b)+":"+hash(ImageIO.read(file.toFile()));
            if(golden==null)golden=value;
            else if(!golden.equals(value))throw new AssertionError("destination/exclusions");
        }
        cases++;
    }
    static BufferedImage custom(int transfer,boolean sub){
        int w=23,h=17;
        ColorSpace cs=ColorSpace.getInstance(ColorSpace.CS_sRGB);
        ComponentColorModel cm=new ComponentColorModel(cs,true,false,Transparency.TRANSLUCENT,transfer);
        int bands=4,stride=128;
        SampleModel sm=new ComponentSampleModel(transfer,w+5,h+5,4,stride,new int[]{
            2,1,0,3
        }
        );
        WritableRaster raster=Raster.createWritableRaster(sm,new Point());
        BufferedImage full=new BufferedImage(cm,raster,false,null);
        Random r=new Random(transfer);
        for(int y=0;y<h;y++)for(int x=0;x<w;x++)full.setRGB(x,y,r.nextInt());
        return sub?full.getSubimage(2,2,w,h):full;
    }
    static void rawbench(String label,BufferedImage a,BufferedImage b)throws Exception{
        ThreadMXBean cpu=ManagementFactory.getThreadMXBean();
        for(int warm=0;warm<8;warm++){
            Object c=(warm%2==0?original:candidate).getConstructor(BufferedImage.class,BufferedImage.class).newInstance(a,b);
            c.getClass().getMethod("compareImages").invoke(c);
        }
        for(int trial=0;trial<8;trial++)for(int j=0;j<2;j++){
            Class<?> cls=((trial+j)%2==0)?original:candidate;
            long p=cpu.getCurrentThreadCpuTime(),t=System.nanoTime();
            Object c=cls.getConstructor(BufferedImage.class,BufferedImage.class).newInstance(a,b),r=cls.getMethod("compareImages").invoke(c);
            long ns=System.nanoTime()-t,cn=cpu.getCurrentThreadCpuTime()-p;
            sink+=Float.floatToIntBits((Float)get(r,"getDifferencePercent"));
            System.out.printf(Locale.ROOT,"RAW %s %d %s %.6f %.6f%n",label,trial,cls==original?"original":"candidate",ns/1e6,cn/1e6);
        }
    }
    public static void main(String[]args)throws Exception{
        original=load("-",args[0]);
        rebuilt=load(args[1],args[0]);
        candidate=load(args[2],args[0]);
        for(int t:new int[]{
            DataBuffer.TYPE_BYTE,DataBuffer.TYPE_USHORT,DataBuffer.TYPE_FLOAT,DataBuffer.TYPE_DOUBLE
        }
        )for(boolean sub:new boolean[]{
            false,true
        }
        )check(custom(t,sub),create(2,23+(sub?0:5),17+(sub?0:5),2,false),7,false);
        for(int seed=0;seed<60;seed++){
            BufferedImage a=new BufferedImage(41,37,2),b=new BufferedImage(41,37,2);
            for(int y=2;y<35;y+=10)for(int x=2;x<39;x+=10)for(int yy=0;yy<2;yy++)for(int xx=0;xx<2;xx++)b.setRGB(x+xx,y+yy,0xff000000|seed*777777);
            check(a,b,seed,seed%2==0);
        }
        outputControls();
        System.out.println("EXTRA_PASS cases="+cases);
        if(args.length>3)return;
        for(String mode:new String[]{
            "equal","one-2x2","336-2x2","mixed-raster","subimage","alpha"
        }
        ){
            int type=mode.equals("alpha")?3:5;
            BufferedImage a=new BufferedImage(1042,1386,type),b=new BufferedImage(1042,1386,mode.equals("mixed-raster")?1:type);
            if(mode.equals("subimage")){
                a=a.getSubimage(3,2,1032,1376);
                b=b.getSubimage(3,2,1032,1376);
            }
            if(!mode.equals("equal")){
                int sp=mode.equals("one-2x2")?2000:64;
                for(int y=20;y<1376;y+=sp)for(int x=20;x<1032;x+=sp)for(int yy=0;yy<2;yy++)for(int xx=0;xx<2;xx++)b.setRGB(x+xx,y+yy,-1);
            }
            rawbench(mode,a,b);
        }
        System.out.println("RAW_PASS sink="+sink);
    }
}
