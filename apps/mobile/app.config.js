import { readFileSync } from "node:fs";

const IS_DEV = process.env.APP_VARIANT === "development";
const GOOGLE_SERVICES_FILE = process.env.GOOGLE_SERVICES_JSON;
if (GOOGLE_SERVICES_FILE) {
  const client = JSON.parse(readFileSync(GOOGLE_SERVICES_FILE, "utf8"));
  const packageName = IS_DEV
    ? "app.hoarder.hoardermobile.dev"
    : "app.hoarder.hoardermobile";
  if (
    client.type === "service_account" ||
    client.private_key ||
    !client.project_info?.project_id ||
    !client.client?.some(
      (item) =>
        item.client_info?.android_client_info?.package_name === packageName,
    )
  ) {
    throw new Error(
      "GOOGLE_SERVICES_JSON must be an Android client configuration matching the APK package, never a service-account private key.",
    );
  }
}

export default {
  expo: {
    ...(IS_DEV
      ? {
          name: "Karakeep (Dev)",
          scheme: "karakeep-dev",
        }
      : {
          name: "Karakeep",
          scheme: "karakeep",
        }),
    slug: "hoarder",
    version: "1.13.0",
    orientation: "portrait",
    icon: "./assets/icon.png",
    userInterfaceStyle: "automatic",
    assetBundlePatterns: ["**/*"],
    experiments: {
      reactCompiler: true,
    },
    ios: {
      supportsTablet: true,
      icon: {
        light: "./assets/icon.png",
        tinted: "./assets/icon-tinted.png",
      },
      bundleIdentifier: IS_DEV
        ? "app.hoarder.hoardermobile.dev"
        : "app.hoarder.hoardermobile",
      splash: {
        image: "./assets/splash.png",
        resizeMode: "contain",
        backgroundColor: "#ffffff",
        dark: {
          image: "./assets/splash-white.png",
          resizeMode: "contain",
          backgroundColor: "#000000",
        },
      },
      config: {
        usesNonExemptEncryption: false,
      },
      infoPlist: {
        NSAppTransportSecurity: {
          NSAllowsArbitraryLoads: true,
        },
      },
      buildNumber: "51",
    },
    android: {
      ...(GOOGLE_SERVICES_FILE
        ? { googleServicesFile: GOOGLE_SERVICES_FILE }
        : {}),
      adaptiveIcon: {
        foregroundImage: "./assets/adaptive-icon.png",
        backgroundColor: "#000000",
        monochromeImage: "./assets/adaptive-icon.png",
      },
      splash: {
        image: "./assets/splash.png",
        resizeMode: "contain",
        backgroundColor: "#ffffff",
        dark: {
          image: "./assets/splash-white.png",
          resizeMode: "contain",
          backgroundColor: "#000000",
        },
      },
      package: IS_DEV
        ? "app.hoarder.hoardermobile.dev"
        : "app.hoarder.hoardermobile",
      versionCode: 51,
    },
    plugins: [
      ...(GOOGLE_SERVICES_FILE
        ? [["expo-notifications", { defaultChannel: "capture-events" }]]
        : []),
      ...(GOOGLE_SERVICES_FILE ? ["./plugins/fcm-opt-in.js"] : []),
      "./plugins/trust-local-certs.js",
      "./plugins/camera-not-required.js",
      "expo-router",
      [
        "expo-share-intent",
        {
          iosActivationRules: {
            NSExtensionActivationSupportsWebURLWithMaxCount: 1,
            NSExtensionActivationSupportsWebPageWithMaxCount: 1,
            NSExtensionActivationSupportsImageWithMaxCount: 1,
            NSExtensionActivationSupportsMovieWithMaxCount: 0,
            NSExtensionActivationSupportsText: true,
            NSExtensionActivationSupportsFileWithMaxCount: 10,
            NSExtensionActivationRule:
              'SUBQUERY (extensionItems, $extensionItem, SUBQUERY ($extensionItem.attachments, $attachment, SUBQUERY ($attachment.registeredTypeIdentifiers, $uti, $uti UTI-CONFORMS-TO "com.adobe.pdf" || $uti UTI-CONFORMS-TO "public.image" || $uti UTI-CONFORMS-TO "public.url" || $uti UTI-CONFORMS-TO "public.plain-text").@count >= 1).@count >= 1).@count >= 1',
          },
          androidIntentFilters: ["text/*", "image/*", "application/pdf"],
        },
      ],
      "expo-secure-store",
      [
        "expo-image-picker",
        {
          photosPermission:
            "The app access your photo gallary on your request to hoard them.",
        },
      ],
      [
        "expo-build-properties",
        {
          android: {
            usesCleartextTraffic: true,
            targetSdkVersion: 36,
            ndkVersion: "27.1.12297006",
          },
          ios: {
            // Apps built with the iOS 27 SDK (Xcode 27) must use the UIScene
            // lifecycle. Can be removed on SDK 58+, where it's the default.
            enableSceneSupport: true,
          },
        },
      ],
      "expo-sharing",
      "expo-web-browser",
      [
        "@sentry/react-native/expo",
        {
          url: "https://sentry.io/",
          project: "react-native",
          organization: "localhost-labs-ltd",
        },
      ],
    ],
    extra: {
      fcmEnabled: !!GOOGLE_SERVICES_FILE,
      router: {
        origin: false,
      },
      eas: {
        projectId: "d6d14643-ad43-4cd3-902a-92c5944d5e45",
      },
    },
  },
};
