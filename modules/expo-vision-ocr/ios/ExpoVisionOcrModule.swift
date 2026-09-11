import ExpoModulesCore
import Vision

public class ExpoVisionOcrModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ExpoVisionOcr")

    Constants([
      "isSupported": true
    ])

    // 로컬 이미지에서 온디바이스 OCR(Apple Vision) 수행. 한국어+영어 인식.
    AsyncFunction("recognizeText") { (uri: String, promise: Promise) in
      // file:// 스킴이 붙어 오면 제거하고 파일 URL 구성
      let path = uri.replacingOccurrences(of: "file://", with: "")
      let url = URL(fileURLWithPath: path)

      guard let imageData = try? Data(contentsOf: url),
            let cgImage = UIImage(data: imageData)?.cgImage else {
        promise.reject("E_IMAGE", "이미지를 읽지 못했어요.")
        return
      }

      let request = VNRecognizeTextRequest { (request, error) in
        if let error = error {
          promise.reject("E_OCR", error.localizedDescription)
          return
        }
        guard let observations = request.results as? [VNRecognizedTextObservation] else {
          promise.resolve([String]())
          return
        }
        let lines = observations.compactMap { $0.topCandidates(1).first?.string }
        promise.resolve(lines)
      }

      // 한국어를 우선 후보로, 영어도 함께 인식. 정확도 우선 + 언어 보정.
      request.recognitionLanguages = ["ko-KR", "en-US"]
      request.recognitionLevel = .accurate
      request.usesLanguageCorrection = true

      let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
      DispatchQueue.global(qos: .userInitiated).async {
        do {
          try handler.perform([request])
        } catch {
          promise.reject("E_OCR", error.localizedDescription)
        }
      }
    }
  }
}
