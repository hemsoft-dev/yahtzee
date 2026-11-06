// Diagnostic-only UIKit fixture for scripts/ios-ax-probe. Not part of Yahtzee.
// Fixed text, one action sheet, one acknowledgment. Events use a fixed vocabulary
// and are written to the app's own Documents folder; nothing user-entered exists.
import QuartzCore
import UIKit

final class ProbeLog {
    static let shared = ProbeLog()
    private let queue = DispatchQueue(label: "dev.hemsoft.axprobe.log")
    private var handle: FileHandle?

    func open() {
        queue.sync {
            guard let directory = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first else { return }
            try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            let url = directory.appendingPathComponent("ax-probe-events.jsonl")
            FileManager.default.createFile(atPath: url.path, contents: nil)
            handle = try? FileHandle(forWritingTo: url)
        }
    }

    /// `t` is CACurrentMediaTime (host monotonic clock on a simulator), `w` is wall-clock seconds.
    func event(_ kind: String, _ extra: [String: Int] = [:]) {
        let monotonic = CACurrentMediaTime()
        let wall = Date().timeIntervalSince1970
        queue.async {
            var record: [String: Any] = ["k": kind, "t": monotonic, "w": wall]
            for (key, value) in extra { record[key] = value }
            guard let handle = self.handle, let data = try? JSONSerialization.data(withJSONObject: record) else { return }
            handle.write(data)
            handle.write(Data([0x0A]))
        }
    }
}

/// Main-run-loop heartbeat. A gap of 250 ms or more is logged as a stall when the loop resumes.
final class Heartbeat {
    private var timer: Timer?
    private var last = CACurrentMediaTime()
    private var ticks = 0
    private var maxGap = 0.0

    func start() {
        last = CACurrentMediaTime()
        let timer = Timer(timeInterval: 0.1, repeats: true) { [weak self] _ in self?.tick() }
        RunLoop.main.add(timer, forMode: .common)
        self.timer = timer
    }

    private func tick() {
        let now = CACurrentMediaTime()
        let gap = now - last
        last = now
        ticks += 1
        maxGap = max(maxGap, gap)
        if gap >= 0.25 { ProbeLog.shared.event("stall", ["g": Int(gap * 1000)]) }
        if ticks >= 10 {
            ProbeLog.shared.event("hb", ["n": ticks, "g": Int(maxGap * 1000)])
            ticks = 0
            maxGap = 0
        }
    }
}

// Passive fixture-only event observation. Always preserve one original dispatch.
final class ProbeWindow: UIWindow {
    private var nextTouch = 0
    private var touches: [ObjectIdentifier: Int] = [:]

    override func sendEvent(_ event: UIEvent) {
        if event.type == .touches, let all = event.allTouches {
            for touch in all.prefix(4) {
                let key = ObjectIdentifier(touch)
                if touch.phase == .began && touches[key] == nil && nextTouch < 128 {
                    nextTouch += 1
                    touches[key] = nextTouch
                }
                if let id = touches[key] {
                    let kind: String?
                    switch touch.phase {
                    case .began: kind = "touch-began"
                    case .ended: kind = "touch-ended"
                    case .cancelled: kind = "touch-cancelled"
                    default: kind = nil
                    }
                    let point = touch.location(in: self)
                    if let kind = kind, point.x.isFinite, point.y.isFinite, abs(point.x) < 1000000, abs(point.y) < 1000000 {
                        var current = touch.view
                        var target = 0
                        while let view = current {
                            if view.accessibilityIdentifier == "probe.open" { target = 1; break }
                            if view is UIButton { target = 2 }
                            current = view.superview
                        }
                        ProbeLog.shared.event(kind, ["q": id, "v": target, "x": Int((point.x * 1000).rounded()), "y": Int((point.y * 1000).rounded())])
                    }
                    if touch.phase == .ended || touch.phase == .cancelled { touches.removeValue(forKey: key) }
                }
            }
        }
        super.sendEvent(event)
    }
}

final class ProbeViewController: UIViewController {
    private let stallMs: Int
    private let intro = UILabel()
    private let openButton = UIButton(type: .system)
    private let ack = UILabel()
    private var appeared = false
    private var lastGeometry: [String: Int]?

    init(stallMs: Int) {
        self.stallMs = stallMs
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) { fatalError("Not used") }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        intro.text = "AX Probe Intro"
        intro.font = .preferredFont(forTextStyle: .title1)
        intro.accessibilityIdentifier = "probe.intro"
        openButton.setTitle("Choose Mode", for: .normal)
        openButton.titleLabel?.font = .preferredFont(forTextStyle: .title2)
        openButton.accessibilityIdentifier = "probe.open"
        openButton.addTarget(self, action: #selector(openSheet), for: .touchUpInside)
        ack.font = .preferredFont(forTextStyle: .title2)
        ack.accessibilityIdentifier = "probe.ack"
        ack.isHidden = true
        let stack = UIStackView(arrangedSubviews: [intro, openButton, ack])
        stack.axis = .vertical
        stack.alignment = .center
        stack.spacing = 32
        stack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            stack.centerYAnchor.constraint(equalTo: view.centerYAnchor),
        ])
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        guard let window = view.window else { return }
        let rect = openButton.convert(openButton.bounds, to: window)
        let numbers = [rect.minX, rect.minY, rect.width, rect.height, window.bounds.width, window.bounds.height, window.screen.scale]
        guard numbers.allSatisfy({ $0.isFinite && abs($0) < 1000000 }) else { return }
        let keys = ["x", "y", "width", "height", "windowW", "windowH", "scale"]
        let geometry = Dictionary(uniqueKeysWithValues: zip(keys, numbers.map { Int(($0 * 1000).rounded()) }))
        if geometry != lastGeometry {
            lastGeometry = geometry
            ProbeLog.shared.event("open-geometry", geometry)
        }
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        if !appeared {
            appeared = true
            ProbeLog.shared.event("appeared")
        }
    }

    @objc private func openSheet() {
        ProbeLog.shared.event("open-pressed")
        if stallMs > 0 {
            // Sensitivity control only: a deliberate main-thread block, never a reproduction.
            Thread.sleep(forTimeInterval: Double(stallMs) / 1000)
            ProbeLog.shared.event("stall-control-done")
        }
        let sheet = UIAlertController(title: nil, message: "Current: Solo", preferredStyle: .actionSheet)
        sheet.addAction(UIAlertAction(title: "Solo", style: .default) { [weak self] _ in
            ProbeLog.shared.event("option-solo")
            self?.acknowledge("Selected: Solo")
        })
        sheet.addAction(UIAlertAction(title: "Duo", style: .default) { [weak self] _ in
            ProbeLog.shared.event("option-duo")
            self?.acknowledge("Selected: Duo")
        })
        sheet.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in
            ProbeLog.shared.event("option-cancel")
        })
        if let popover = sheet.popoverPresentationController {
            popover.sourceView = openButton
            popover.sourceRect = openButton.bounds
        }
        present(sheet, animated: true) { ProbeLog.shared.event("sheet-presented") }
    }

    /// Records that the handler set the label. It does not prove paint or AX visibility.
    private func acknowledge(_ text: String) {
        ack.text = text
        ack.isHidden = false
        ProbeLog.shared.event("ack-set")
    }
}

final class ProbeSceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?
    private let heartbeat = Heartbeat()

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }
        let window = ProbeWindow(windowScene: windowScene)
        let requested = UserDefaults.standard.integer(forKey: "probeStallMs")
        window.rootViewController = ProbeViewController(stallMs: requested == 3000 ? 3000 : 0)
        window.makeKeyAndVisible()
        self.window = window
        heartbeat.start()
    }
}

@main
final class ProbeAppDelegate: UIResponder, UIApplicationDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        ProbeLog.shared.open()
        ProbeLog.shared.event("launch", ["pid": Int(getpid())])
        return true
    }

    func application(_ application: UIApplication, configurationForConnecting connectingSceneSession: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let configuration = UISceneConfiguration(name: "Default", sessionRole: connectingSceneSession.role)
        configuration.delegateClass = ProbeSceneDelegate.self
        return configuration
    }
}
