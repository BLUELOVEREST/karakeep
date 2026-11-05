const { withAndroidManifest } = require("@expo/config-plugins");

module.exports = (config) =>
  withAndroidManifest(config, (config) => {
    const application = config.modResults.manifest.application[0];
    const name = "firebase_messaging_auto_init_enabled";
    application["meta-data"] = [
      ...(application["meta-data"] ?? []).filter(
        (item) => item.$["android:name"] !== name,
      ),
      { $: { "android:name": name, "android:value": "false" } },
    ];
    return config;
  });
