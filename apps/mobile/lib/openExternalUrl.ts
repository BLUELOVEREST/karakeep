import { Linking } from "react-native";

import { getPlatformAppUrlCandidate } from "@karakeep/shared/utils/platformUrl";

export async function openExternalUrl(url: string) {
  const candidate = getPlatformAppUrlCandidate(url);
  if (candidate) {
    try {
      await Linking.openURL(candidate.appUrl);
      return;
    } catch {
      // Fall back to the web URL when the target app is not installed or the
      // platform-specific scheme is unsupported on this device.
    }
  }

  await Linking.openURL(url);
}
