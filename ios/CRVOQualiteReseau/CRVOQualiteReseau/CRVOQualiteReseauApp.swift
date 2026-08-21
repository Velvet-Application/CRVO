import SwiftUI

@main
struct CRVOQualiteReseauApp: App {
    @StateObject private var store = NetworkStore()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(store)
                .tint(Color(red: 0, green: 0.31, blue: 0.62))
        }
    }
}
