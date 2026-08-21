import Foundation

struct PortalSession: Codable, Equatable {
    let portalURL: String
    let token: String
    let origin: String

    init?(portalURL: String) {
        let clean = portalURL.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let url = URL(string: clean), let scheme = url.scheme, let host = url.host else { return nil }
        let components = url.pathComponents.filter { $0 != "/" }
        guard let token = components.last, token.count >= 32 else { return nil }
        self.portalURL = clean
        self.token = token
        var origin = "\(scheme)://\(host)"
        if let port = url.port { origin += ":\(port)" }
        self.origin = origin
    }

    var apiRoot: URL? { URL(string: "\(origin)/api/quality-claims/client/\(token)") }
}

struct QualityDashboard: Codable {
    struct Context: Codable { let client: String; let partnerLabel: String; let dealerCode: String?; let siteCode: String }
    struct Metrics: Codable { let total: Int; let open: Int; let waiting: Int; let accepted: Int }
    let connected: Bool
    let context: Context
    let metrics: Metrics
    let claims: [QualityClaim]
    let detail: QualityDetail?
}

struct QualityClaim: Codable, Identifiable, Equatable {
    let id: String
    let claimNumber: String
    let registration: String
    let workOrder: String?
    let vin: String?
    let model: String?
    let mileage: Double?
    let category: String
    let description: String
    let status: String
    let decision: String?
    let committeeResponse: String?
    let requestedInfo: String?
    let estimateAmount: Double?
    let acceptedAmount: Double?
    let declaredAt: String
    let decisionAt: String?
    let closedAt: String?
    let updatedAt: String
}

struct QualityMessage: Codable, Identifiable, Equatable {
    let id: Int
    let authorRole: String
    let authorName: String?
    let body: String
    let createdAt: String
}

struct QualityAttachment: Codable, Identifiable, Equatable {
    let id: String
    let kind: String
    let fileName: String
    let mimeType: String
    let sizeBytes: Int
    let createdAt: String
}

struct QualityDetail: Codable {
    let claim: QualityClaim
    let messages: [QualityMessage]
    let attachments: [QualityAttachment]
}

struct VehicleLookup: Codable {
    struct Vehicle: Codable {
        let registration: String
        let workOrder: String?
        let vin: String?
        let model: String?
        let mileage: Double?
        let client: String
        let status: String?
    }
    let connected: Bool
    let found: Bool
    let registration: String?
    let vehicle: Vehicle?
}

struct ClaimCreatePayload {
    let registration: String
    let category: String
    let description: String
    let estimateAmount: String
    let lookup: VehicleLookup?
}

struct QualityBanner: Equatable, Identifiable {
    let id = UUID()
    let title: String
    let message: String
    let claimId: String?
}

extension JSONDecoder {
    static var crvo: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        return decoder
    }
}

extension QualityClaim {
    var statusLabel: String {
        ["RECEIVED":"Reçue","ANALYSIS":"En analyse","WAITING_NETWORK":"Complément demandé","COMMITTEE":"En comité","ACCEPTED":"Acceptée","REFUSED":"Refusée","CLOSED":"Clôturée"][status] ?? status
    }
}
