import Foundation
import SwiftUI

@MainActor
final class NetworkStore: ObservableObject {
    @Published var session: PortalSession?
    @Published var dashboard: QualityDashboard?
    @Published var detail: QualityDetail?
    @Published var lookup: VehicleLookup?
    @Published var banner: QualityBanner?
    @Published var loading = false
    @Published var errorMessage: String?

    private var api: CRVOQualityAPI?
    private var pollTask: Task<Void, Never>?
    private var knownUpdates: [String: String] = [:]
    private var knownMessageIds: [String: Int] = [:]
    private let sessionKey = "crvo.quality.network.portalURL"

    init() {
        if let raw = UserDefaults.standard.string(forKey: sessionKey), let parsed = PortalSession(portalURL: raw) {
            configure(parsed)
        }
    }

    func connect(url: String) async {
        guard let parsed = PortalSession(portalURL: url) else { errorMessage = "Collez le lien complet fourni par le CRVO."; return }
        configure(parsed)
        UserDefaults.standard.set(parsed.portalURL, forKey: sessionKey)
        await refresh(showLoading: true)
        if dashboard == nil { disconnect() }
    }

    func disconnect() {
        pollTask?.cancel(); pollTask = nil
        UserDefaults.standard.removeObject(forKey: sessionKey)
        session = nil; dashboard = nil; detail = nil; lookup = nil; api = nil; knownUpdates = [:]; knownMessageIds = [:]
    }

    private func configure(_ parsed: PortalSession) {
        session = parsed
        api = CRVOQualityAPI(session: parsed)
        startPolling()
    }

    func refresh(showLoading: Bool = false) async {
        guard let api else { return }
        if showLoading { loading = true }
        defer { if showLoading { loading = false } }
        do {
            let next = try await api.dashboard()
            detectChanges(next)
            dashboard = next
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func openClaim(_ id: String) async {
        guard let api else { return }
        loading = true; defer { loading = false }
        do {
            let payload = try await api.dashboard(claimId: id)
            if let next = payload.detail {
                detectMessages(next)
                detail = next
            }
            dashboard = payload
            errorMessage = nil
        } catch { errorMessage = error.localizedDescription }
    }

    func searchVehicle(_ registration: String) async {
        guard let api else { return }
        loading = true; defer { loading = false }
        do { lookup = try await api.lookup(registration: registration); errorMessage = nil }
        catch { errorMessage = error.localizedDescription }
    }

    func createClaim(registration: String, category: String, description: String, estimate: String) async -> String? {
        guard let api else { return nil }
        loading = true; defer { loading = false }
        do {
            let next = try await api.create(.init(registration: registration, category: category, description: description, estimateAmount: estimate, lookup: lookup))
            detail = next
            await refresh()
            return next.claim.id
        } catch { errorMessage = error.localizedDescription; return nil }
    }

    func sendMessage(_ body: String) async {
        guard let api, let claim = detail?.claim, !body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        do { detail = try await api.sendMessage(claimId: claim.id, body: body); await refresh() }
        catch { errorMessage = error.localizedDescription }
    }

    func upload(claimId: String, fileName: String, mimeType: String, data: Data) async {
        guard let api else { return }
        do { try await api.upload(claimId: claimId, fileName: fileName, mimeType: mimeType, data: data); await openClaim(claimId) }
        catch { errorMessage = error.localizedDescription }
    }

    func attachmentURL(_ id: String) async -> URL? { await api?.attachmentURL(id: id) }

    private func startPolling() {
        pollTask?.cancel()
        pollTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(12))
                guard let self else { return }
                await self.refresh()
                if let id = self.detail?.claim.id { await self.openClaimSilently(id) }
            }
        }
    }

    private func openClaimSilently(_ id: String) async {
        guard let api else { return }
        do {
            let payload = try await api.dashboard(claimId: id)
            if let next = payload.detail { detectMessages(next); detail = next }
            dashboard = payload
        } catch { }
    }

    private func detectChanges(_ next: QualityDashboard) {
        if knownUpdates.isEmpty { knownUpdates = Dictionary(uniqueKeysWithValues: next.claims.map { ($0.id, $0.updatedAt) }); return }
        for claim in next.claims {
            if let previous = knownUpdates[claim.id], previous != claim.updatedAt, detail?.claim.id != claim.id {
                showBanner(title: "Dossier mis à jour", message: "\(claim.registration) · \(claim.statusLabel)", claimId: claim.id)
                break
            }
        }
        knownUpdates = Dictionary(uniqueKeysWithValues: next.claims.map { ($0.id, $0.updatedAt) })
    }

    private func detectMessages(_ next: QualityDetail) {
        guard let last = next.messages.max(by: { $0.id < $1.id }) else { return }
        let previous = knownMessageIds[next.claim.id]
        knownMessageIds[next.claim.id] = last.id
        if let previous, last.id > previous, last.authorRole == "CRVO" {
            showBanner(title: "Nouveau message du CRVO", message: "\(next.claim.registration) · \(last.body)", claimId: next.claim.id)
        }
    }

    private func showBanner(title: String, message: String, claimId: String?) {
        let value = QualityBanner(title: title, message: String(message.prefix(150)), claimId: claimId)
        banner = value
        Task { [weak self] in
            try? await Task.sleep(for: .seconds(7))
            if self?.banner?.id == value.id { self?.banner = nil }
        }
    }
}
