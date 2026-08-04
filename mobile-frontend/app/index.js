import "expo-router/entry";
import { Platform } from "react-native";

// Android home-screen widgets only. registerWidgetTaskHandler uses
// AppRegistry.registerHeadlessTask, which does not exist on web.
if (Platform.OS === "android") {
  // Dynamic require so web/iOS never load the native widget module.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { registerWidgetTaskHandler } = require("react-native-android-widget");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { widgetTaskHandler } = require("./widgets/task-handler");
  registerWidgetTaskHandler(widgetTaskHandler);
}
