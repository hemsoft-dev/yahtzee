
// Separate source-bound qualification, never substituted for ordinary released-driver tests.
final class HSAXRequestQualificationTests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure = true }

    func test00ForwardOnceControls() { XCTAssertTrue(HSAXForwardingControls()) }

    @MainActor
    func test10ActualDeviceInfoRequest() async throws {
        let app = XCUIApplication(bundleIdentifier: "com.hemsoft.thirdroll")
        app.launch()
        let request = HTTPRequest(method: .POST, version: .http11, path: "/deviceInfo", query: [], headers: [:], body: Data())
        let response = try await DeviceInfoHandler().handleRequest(request)
        XCTAssertEqual(response.statusCode, .ok)
        let bytes = try await response.bodyData
        let value = try JSONDecoder().decode(DeviceInfoResponse.self, from: bytes)
        XCTAssertGreaterThan(value.widthPoints, 0)
        XCTAssertGreaterThan(value.heightPoints, 0)
    }
}
