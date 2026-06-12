// swift-tools-version: 5.9
import PackageDescription

let package = Package(
  name: "LiteRTLM",
  platforms: [
    .iOS(.v15),
  ],
  products: [
    .library(
      name: "LiteRTLM",
      targets: ["LiteRTLM"]
    )
  ],
  targets: [
    .binaryTarget(
      name: "CLiteRTLM",
      path: "Artifacts/CLiteRTLM.xcframework"
    ),
    .target(
      name: "LiteRTLM",
      dependencies: [
        .target(name: "CLiteRTLM", condition: .when(platforms: [.iOS])),
      ],
      path: "swift",
      linkerSettings: [
        .unsafeFlags(["-Xlinker", "-all_load"])
      ]
    ),
  ]
)
