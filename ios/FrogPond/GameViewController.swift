import UIKit
import WebKit

final class GameViewController: UIViewController, WKNavigationDelegate {
    override var prefersStatusBarHidden: Bool { true }

    override func loadView() {
        let configuration = WKWebViewConfiguration()
        configuration.allowsInlineMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = []

        if let audioURL = Bundle.main.url(forResource: "frog-croak", withExtension: "mp3"),
           let audioData = try? Data(contentsOf: audioURL) {
            let dataURL = "data:audio/mpeg;base64," + audioData.base64EncodedString()
            let script = WKUserScript(
                source: "window.frogCroakDataURL = '\(dataURL)';",
                injectionTime: .atDocumentStart,
                forMainFrameOnly: true
            )
            configuration.userContentController.addUserScript(script)
        }

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = self
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.scrollView.bounces = false
        webView.isOpaque = false
        webView.backgroundColor = UIColor(red: 0.05, green: 0.11, blue: 0.12, alpha: 1)
        view = webView

        guard let resourceURL = Bundle.main.resourceURL,
              let indexURL = Bundle.main.url(forResource: "index", withExtension: "html") else {
            webView.loadHTMLString("<p>无法加载游戏资源，请重新安装应用。</p>", baseURL: nil)
            return
        }
        webView.loadFileURL(indexURL, allowingReadAccessTo: resourceURL)
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        guard let url = navigationAction.request.url else {
            decisionHandler(.cancel)
            return
        }
        decisionHandler(url.isFileURL || url.scheme == "about" ? .allow : .cancel)
    }

    #if DEBUG
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard ProcessInfo.processInfo.arguments.contains("--frog-smoke-test") else { return }
        let script = """
        const audio = await prepareFrogCroak();
        addBlock('chirp');
        stepOnce();
        return {
          protocol: location.protocol,
          frogs: state.frogs.length,
          cells: CELLS.length,
          blocks: countCards(),
          pc: state.frogs[0].pc,
          audioDuration: audio ? audio.duration : 0,
          localAudio: !!window.frogCroakDataURL,
          canvasWidth: canvas.width,
          canvasHeight: canvas.height
        };
        """
        webView.callAsyncJavaScript(script, arguments: [:], in: nil, in: .page) { result in
            let output: [String: Any]
            switch result {
            case .success(let value):
                output = value as? [String: Any] ?? ["error": "Invalid result"]
            case .failure(let error):
                output = ["error": error.localizedDescription]
            }
            if let data = try? JSONSerialization.data(withJSONObject: output),
               let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first {
                try? data.write(to: documents.appendingPathComponent("FrogPondSmokeTest.json"))
            }
        }
    }
    #endif
}
