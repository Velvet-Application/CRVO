import SwiftUI
import PhotosUI

private let crvoBlue = Color(red: 0, green: 0.31, blue: 0.62)
private let crvoCyan = Color(red: 0, green: 0.62, blue: 0.86)

struct ContentView: View {
    @EnvironmentObject private var store: NetworkStore
    var body: some View {
        ZStack(alignment: .top) {
            if store.session == nil { AccessSetupView() }
            else { PortalTabs() }
            if let banner = store.banner { LiveBanner(banner: banner) }
        }
        .task { if store.session != nil { await store.refresh(showLoading: true) } }
        .alert("CRVO Qualité", isPresented: Binding(get: { store.errorMessage != nil }, set: { if !$0 { store.errorMessage = nil } })) {
            Button("OK") { store.errorMessage = nil }
        } message: { Text(store.errorMessage ?? "") }
    }
}

private struct AccessSetupView: View {
    @EnvironmentObject private var store: NetworkStore
    @State private var link = ""
    var body: some View {
        ZStack {
            LinearGradient(colors: [crvoBlue, Color(red: 0, green: 0.48, blue: 0.72)], startPoint: .topLeading, endPoint: .bottomTrailing).ignoresSafeArea()
            VStack(spacing: 22) {
                Text("CRVO").font(.system(size: 26, weight: .black, design: .rounded)).foregroundStyle(.white).frame(width: 88, height: 88).background(.white.opacity(0.13)).clipShape(RoundedRectangle(cornerRadius: 26))
                VStack(spacing: 8) {
                    Text("Qualité réseau").font(.largeTitle.bold()).foregroundStyle(.white)
                    Text("Retrouvez vos réclamations, déclarez une anomalie et échangez avec le CRVO depuis votre iPhone.").font(.subheadline).multilineTextAlignment(.center).foregroundStyle(.white.opacity(0.82))
                }
                VStack(alignment: .leading, spacing: 9) {
                    Text("LIEN D’ACCÈS / QR CRVO").font(.caption2.bold()).foregroundStyle(crvoCyan)
                    TextField("https://…/q/…", text: $link).textInputAutocapitalization(.never).keyboardType(.URL).autocorrectionDisabled().padding(14).background(.white).clipShape(RoundedRectangle(cornerRadius: 14))
                    Button {
                        Task { await store.connect(url: link) }
                    } label: {
                        HStack { if store.loading { ProgressView().tint(.white) }; Text("OUVRIR MON ESPACE").font(.caption.bold()); Spacer(); Image(systemName: "arrow.right") }
                            .padding(15).foregroundStyle(.white).background(Color.black.opacity(0.18)).clipShape(RoundedRectangle(cornerRadius: 14))
                    }.disabled(link.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || store.loading)
                }.padding(18).background(.white.opacity(0.10)).clipShape(RoundedRectangle(cornerRadius: 20))
            }.padding(24)
        }
    }
}

private struct PortalTabs: View {
    @EnvironmentObject private var store: NetworkStore
    var body: some View {
        TabView {
            NavigationStack { HomeView() }.tabItem { Label("Accueil", systemImage: "square.grid.2x2.fill") }
            NavigationStack { ClaimsView() }.tabItem { Label("Demandes", systemImage: "tray.full.fill") }
            NavigationStack { NewClaimView() }.tabItem { Label("Déclarer", systemImage: "plus.circle.fill") }
        }
    }
}

private struct HomeView: View {
    @EnvironmentObject private var store: NetworkStore
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                if let data = store.dashboard {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("RELATION CLIENT · CRVO \(data.context.siteCode)").font(.caption2.bold()).foregroundStyle(crvoCyan)
                        Text("Bonjour \(data.context.partnerLabel)").font(.largeTitle.bold()).foregroundStyle(.white)
                        Text("Suivez vos dossiers Qualité et échangez avec l’équipe CRVO.").font(.subheadline).foregroundStyle(.white.opacity(0.83))
                    }.frame(maxWidth: .infinity, alignment: .leading).padding(22).background(LinearGradient(colors: [crvoBlue, Color(red: 0, green: 0.48, blue: 0.72)], startPoint: .topLeading, endPoint: .bottomTrailing)).clipShape(RoundedRectangle(cornerRadius: 24))
                    LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
                        MetricCard(value: data.metrics.open, label: "En cours")
                        MetricCard(value: data.metrics.waiting, label: "Complément attendu")
                        MetricCard(value: data.metrics.accepted, label: "Acceptées")
                        MetricCard(value: data.metrics.total, label: "Historique")
                    }
                    VStack(alignment: .leading, spacing: 10) {
                        Text("DERNIÈRES DEMANDES").font(.caption2.bold()).foregroundStyle(crvoCyan)
                        ForEach(data.claims.prefix(6)) { claim in ClaimNavigationRow(claim: claim) }
                    }
                } else if store.loading { ProgressView("Chargement…").frame(maxWidth: .infinity, minHeight: 320) }
            }.padding()
        }
        .navigationTitle("Qualité réseau")
        .toolbar { ToolbarItem(placement: .topBarTrailing) { Button { Task { await store.refresh(showLoading: true) } } label: { Image(systemName: "arrow.clockwise") } } }
    }
}

private struct MetricCard: View {
    let value: Int; let label: String
    var body: some View { VStack(alignment: .leading, spacing: 5) { Text("\(value)").font(.system(size: 30, weight: .black)).foregroundStyle(crvoBlue); Text(label).font(.caption).foregroundStyle(.secondary) }.frame(maxWidth: .infinity, alignment: .leading).padding(16).background(Color.white).clipShape(RoundedRectangle(cornerRadius: 16)).shadow(color: .black.opacity(0.05), radius: 10, y: 4) }
}

private struct ClaimsView: View {
    @EnvironmentObject private var store: NetworkStore
    @State private var search = ""
    var claims: [QualityClaim] { let q = search.lowercased(); return (store.dashboard?.claims ?? []).filter { q.isEmpty || "\($0.registration) \($0.claimNumber) \($0.category)".lowercased().contains(q) } }
    var body: some View {
        List(claims) { ClaimNavigationRow(claim: $0) }
            .listStyle(.plain)
            .searchable(text: $search, prompt: "Immatriculation ou dossier")
            .navigationTitle("Mes réclamations")
            .refreshable { await store.refresh() }
    }
}

private struct ClaimNavigationRow: View {
    let claim: QualityClaim
    var body: some View {
        NavigationLink { ClaimDetailView(claimId: claim.id) } label: {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 4) { Text(claim.registration).font(.headline).foregroundStyle(crvoBlue); Text("\(claim.claimNumber) · \(claim.category)").font(.caption).foregroundStyle(.secondary) }
                Spacer(); Text(claim.statusLabel).font(.caption2.bold()).padding(.horizontal, 9).padding(.vertical, 6).background(crvoCyan.opacity(0.12)).foregroundStyle(crvoBlue).clipShape(Capsule())
            }.padding(.vertical, 5)
        }
    }
}

private struct NewClaimView: View {
    @EnvironmentObject private var store: NetworkStore
    @State private var registration = ""
    @State private var category = "Mécanique"
    @State private var description = ""
    @State private var estimate = ""
    @State private var photos: [PhotosPickerItem] = []
    @State private var createdClaimId: String?
    let categories = ["Mécanique","Carrosserie","Préparation esthétique","Pneus / Jantes","Vitrage","Sellerie","Facturation / Carburant","Autre"]
    var body: some View {
        Form {
            Section("1 · Identifier le véhicule") {
                TextField("AA-123-BB", text: $registration).textInputAutocapitalization(.characters).autocorrectionDisabled()
                Button("Rechercher dans le CRVO") { Task { await store.searchVehicle(registration.uppercased()) } }.disabled(registration.count < 4)
                if let lookup = store.lookup { if lookup.found { Label(lookup.vehicle?.model ?? "Véhicule retrouvé", systemImage: "checkmark.circle.fill").foregroundStyle(.green); Text("OR \(lookup.vehicle?.workOrder ?? "—") · VIN \(lookup.vehicle?.vin ?? "—")").font(.caption).foregroundStyle(.secondary) } else { Label("Immatriculation non retrouvée — vous pouvez poursuivre", systemImage: "exclamationmark.circle").foregroundStyle(.orange) } }
            }
            Section("2 · Décrire le problème") {
                Picker("Nature", selection: $category) { ForEach(categories, id: \.self) { Text($0) } }
                TextField("Décrivez précisément le défaut…", text: $description, axis: .vertical).lineLimit(4...9)
                TextField("Montant estimé / devis (€)", text: $estimate).keyboardType(.decimalPad)
            }
            Section("3 · Photos") {
                PhotosPicker(selection: $photos, maxSelectionCount: 8, matching: .images) { Label("Prendre / ajouter des photos", systemImage: "camera.fill") }
                if !photos.isEmpty { Text("\(photos.count) photo(s) sélectionnée(s)").font(.caption).foregroundStyle(.secondary) }
            }
            Section {
                Button {
                    Task {
                        guard let id = await store.createClaim(registration: registration.uppercased(), category: category, description: description, estimate: estimate) else { return }
                        createdClaimId = id
                        for (index, item) in photos.enumerated() {
                            if let data = try? await item.loadTransferable(type: Data.self) { await store.upload(claimId: id, fileName: "photo-\(index + 1).jpg", mimeType: "image/jpeg", data: data) }
                        }
                        registration = ""; description = ""; estimate = ""; photos = []; store.lookup = nil
                    }
                } label: { HStack { Spacer(); if store.loading { ProgressView() }; Text("ENVOYER LA RÉCLAMATION").font(.caption.bold()); Spacer() } }
                .disabled(registration.count < 4 || description.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || store.loading)
            }
        }
        .navigationTitle("Déclarer")
        .sheet(item: Binding(get: { createdClaimId.map(StringBox.init) }, set: { if $0 == nil { createdClaimId = nil } })) { box in NavigationStack { ClaimDetailView(claimId: box.value).toolbar { ToolbarItem(placement: .topBarLeading) { Button("Fermer") { createdClaimId = nil } } } } }
    }
}

private struct StringBox: Identifiable { let id = UUID(); let value: String; init(_ value: String) { self.value = value } }

private struct ClaimDetailView: View {
    @EnvironmentObject private var store: NetworkStore
    let claimId: String
    @State private var message = ""
    @State private var previewURL: URL?
    var body: some View {
        ScrollView {
            if let detail = store.detail, detail.claim.id == claimId {
                VStack(alignment: .leading, spacing: 16) {
                    HStack { VStack(alignment: .leading) { Text(detail.claim.claimNumber).font(.caption2.bold()).foregroundStyle(crvoCyan); Text(detail.claim.registration).font(.largeTitle.bold()).foregroundStyle(crvoBlue); Text(detail.claim.category).font(.caption).foregroundStyle(.secondary) }; Spacer(); Text(detail.claim.statusLabel).font(.caption2.bold()).padding(8).background(crvoCyan.opacity(0.12)).clipShape(Capsule()) }
                    if detail.claim.status == "WAITING_NETWORK" { VStack(alignment: .leading, spacing: 5) { Text("COMPLÉMENT DEMANDÉ").font(.caption2.bold()).foregroundStyle(.orange); Text(detail.claim.requestedInfo ?? "Le CRVO attend des informations complémentaires.") }.padding().frame(maxWidth: .infinity, alignment: .leading).background(Color.orange.opacity(0.08)).clipShape(RoundedRectangle(cornerRadius: 14)) }
                    if let response = detail.claim.committeeResponse, !response.isEmpty { VStack(alignment: .leading, spacing: 5) { Text("RÉPONSE DU COMITÉ").font(.caption2.bold()).foregroundStyle(crvoCyan); Text(response) }.padding().frame(maxWidth: .infinity, alignment: .leading).background(crvoCyan.opacity(0.07)).clipShape(RoundedRectangle(cornerRadius: 14)) }
                    if !detail.attachments.isEmpty {
                        VStack(alignment: .leading, spacing: 8) { Text("PHOTOS & DOCUMENTS").font(.caption2.bold()).foregroundStyle(crvoCyan); ForEach(detail.attachments) { file in Button { Task { previewURL = await store.attachmentURL(file.id) } } label: { HStack { Image(systemName: file.mimeType.hasPrefix("image/") ? "photo.fill" : "doc.fill"); VStack(alignment: .leading) { Text(file.fileName).font(.caption.bold()); Text(file.kind).font(.caption2).foregroundStyle(.secondary) }; Spacer(); Image(systemName: "arrow.up.left.and.arrow.down.right") }.padding(10).background(Color.white).clipShape(RoundedRectangle(cornerRadius: 12)) } } }
                    }
                    VStack(alignment: .leading, spacing: 10) {
                        Text("ÉCHANGES AVEC LE CRVO").font(.caption2.bold()).foregroundStyle(crvoCyan)
                        ForEach(detail.messages) { m in HStack { if m.authorRole == "CRVO" { Spacer(minLength: 32) }; VStack(alignment: .leading, spacing: 4) { Text(m.authorRole == "CRVO" ? "CRVO" : (m.authorName ?? "Réseau")).font(.caption2.bold()); Text(m.body).font(.caption); Text(m.createdAt).font(.system(size: 8)).foregroundStyle(.secondary) }.padding(10).background(m.authorRole == "CRVO" ? crvoCyan.opacity(0.13) : Color.white).clipShape(RoundedRectangle(cornerRadius: 12)); if m.authorRole != "CRVO" { Spacer(minLength: 32) } }
                        }
                        HStack(alignment: .bottom) { TextField("Écrire au CRVO…", text: $message, axis: .vertical).lineLimit(1...4).textFieldStyle(.roundedBorder); Button { let value = message; message = ""; Task { await store.sendMessage(value) } } label: { Image(systemName: "paperplane.fill").frame(width: 40, height: 40).background(crvoBlue).foregroundStyle(.white).clipShape(RoundedRectangle(cornerRadius: 12)) }.disabled(message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty) }
                    }
                }.padding()
            } else { ProgressView("Ouverture du dossier…").frame(maxWidth: .infinity, minHeight: 400) }
        }
        .background(Color(red: 0.96, green: 0.98, blue: 0.99))
        .navigationTitle("Réclamation")
        .navigationBarTitleDisplayMode(.inline)
        .task { await store.openClaim(claimId) }
        .sheet(isPresented: Binding(get: { previewURL != nil }, set: { if !$0 { previewURL = nil } })) { if let url = previewURL { FullScreenDocumentView(url: url) } }
    }
}

private struct FullScreenDocumentView: View {
    @Environment(\.dismiss) private var dismiss
    let url: URL
    var body: some View { NavigationStack { ZStack { Color.black.ignoresSafeArea(); AsyncImage(url: url) { phase in switch phase { case .success(let image): image.resizable().scaledToFit(); case .failure: VStack { Image(systemName: "doc.fill").font(.largeTitle); Text("Ce document ne peut pas être prévisualisé comme une image.") }.foregroundStyle(.white); default: ProgressView().tint(.white) } } }.toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Fermer") { dismiss() }.foregroundStyle(.white) } } } }
}

private struct LiveBanner: View {
    @EnvironmentObject private var store: NetworkStore
    let banner: QualityBanner
    var body: some View { Button { if let id = banner.claimId { Task { await store.openClaim(id) } }; store.banner = nil } label: { HStack(spacing: 11) { Text("RQ").font(.caption.bold()).frame(width: 38, height: 38).background(LinearGradient(colors: [crvoBlue, crvoCyan], startPoint: .topLeading, endPoint: .bottomTrailing)).foregroundStyle(.white).clipShape(RoundedRectangle(cornerRadius: 11)); VStack(alignment: .leading, spacing: 2) { Text(banner.title).font(.caption.bold()).foregroundStyle(.primary); Text(banner.message).font(.caption2).foregroundStyle(.secondary).lineLimit(2) }; Spacer(); Image(systemName: "chevron.right").foregroundStyle(.secondary) }.padding(12).background(.ultraThinMaterial).clipShape(RoundedRectangle(cornerRadius: 16)).shadow(radius: 14) }.buttonStyle(.plain).padding(.horizontal, 12).padding(.top, 8) }
}
