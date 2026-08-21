import Foundation

actor CRVOQualityAPI {
    enum APIError: LocalizedError {
        case invalidSession
        case server(String)
        case invalidResponse
        var errorDescription: String? {
            switch self {
            case .invalidSession: return "Lien d’accès CRVO invalide."
            case .server(let message): return message
            case .invalidResponse: return "Réponse serveur invalide."
            }
        }
    }

    let session: PortalSession
    init(session: PortalSession) { self.session = session }

    private func request(pathQuery: String = "", method: String = "GET", json: [String: Any]? = nil) async throws -> Data {
        guard let root = session.apiRoot, let url = URL(string: root.absoluteString + pathQuery) else { throw APIError.invalidSession }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let json {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: json)
        }
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw APIError.invalidResponse }
        guard 200..<300 ~= http.statusCode else {
            let payload = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])
            throw APIError.server(payload?["error"] as? String ?? "Service temporairement indisponible.")
        }
        return data
    }

    func dashboard(claimId: String? = nil) async throws -> QualityDashboard {
        let suffix = claimId.map { "?claimId=\($0.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? $0)&_=\(Int(Date().timeIntervalSince1970))" } ?? "?_=\(Int(Date().timeIntervalSince1970))"
        let data = try await request(pathQuery: suffix)
        return try JSONDecoder.crvo.decode(QualityDashboard.self, from: data)
    }

    func lookup(registration: String) async throws -> VehicleLookup {
        let value = registration.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? registration
        let data = try await request(pathQuery: "?registration=\(value)&_=\(Int(Date().timeIntervalSince1970))")
        return try JSONDecoder.crvo.decode(VehicleLookup.self, from: data)
    }

    func create(_ payload: ClaimCreatePayload) async throws -> QualityDetail {
        var values: [String: Any] = ["registration": payload.registration,"category": payload.category,"description": payload.description]
        if !payload.estimateAmount.isEmpty { values["estimateAmount"] = payload.estimateAmount }
        if let vehicle = payload.lookup?.vehicle {
            if let value = vehicle.workOrder { values["workOrder"] = value }
            if let value = vehicle.vin { values["vin"] = value }
            if let value = vehicle.model { values["model"] = value }
            if let value = vehicle.mileage { values["mileage"] = value }
        }
        let data = try await request(method: "POST", json: ["action":"create","payload":values])
        struct Envelope: Codable { let detail: QualityDetail }
        return try JSONDecoder.crvo.decode(Envelope.self, from: data).detail
    }

    func sendMessage(claimId: String, body: String) async throws -> QualityDetail {
        let data = try await request(method: "POST", json: ["action":"message","claimId":claimId,"message":body])
        struct Envelope: Codable { let detail: QualityDetail }
        return try JSONDecoder.crvo.decode(Envelope.self, from: data).detail
    }

    func upload(claimId: String, fileName: String, mimeType: String, data: Data) async throws {
        let kind = mimeType.hasPrefix("image/") ? "PHOTO" : mimeType == "application/pdf" ? "QUOTE" : "OTHER"
        _ = try await request(method: "POST", json: ["action":"attachment","claimId":claimId,"attachment":["kind":kind,"fileName":fileName,"mimeType":mimeType,"sizeBytes":data.count,"fileData":data.base64EncodedString()]])
    }

    func attachmentURL(id: String) -> URL? {
        guard let root = session.apiRoot, let encoded = id.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) else { return nil }
        return URL(string: root.absoluteString + "?attachmentId=" + encoded)
    }
}
