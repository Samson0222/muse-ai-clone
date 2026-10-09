import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { WebView } from 'react-native-webview';
import * as WebBrowser from 'expo-web-browser';
import { Colors } from '@/constants/colors';
import { BrowserBaseSessionToolOutput } from '@/types';

type ChatBrowserPreviewProps = {
  browserPreview: BrowserBaseSessionToolOutput;
};

export function ChatBrowserPreview({ browserPreview }: ChatBrowserPreviewProps) {
  const previewUrl = browserPreview?.previewUrl;
  if (!previewUrl) return null;

  return (
    <View style={styles.browserPreview}>
      {/* Embedded Live Cloud Browser View */}
      <WebView
        source={{ uri: previewUrl }}
        style={styles.browserPreviewFrame}
        originWhitelist={['*']}
        javaScriptEnabled
        domStorageEnabled
        startInLoadingState
        renderLoading={() => (
          <View style={styles.browserPreviewLoading}>
            <ActivityIndicator color={Colors.iconDark} />
          </View>
        )}
      />

      {/* Button to open full interactive session in system browser */}
      <TouchableOpacity
        activeOpacity={0.85}
        style={styles.openBrowserButton}
        onPress={() => WebBrowser.openBrowserAsync(previewUrl ?? "")}>
        <Text style={styles.openBrowserButtonText}>Open Browser</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  browserPreview: {
    marginTop: 12,
    backgroundColor: Colors.browserPreviewBg,
    borderWidth: 1,
    borderColor: Colors.border, // Uses theme token instead of hardcoded hex
    borderRadius: 16,
    overflow: 'hidden',
  },
  browserPreviewFrame: {
    height: 220,
    backgroundColor: Colors.white,
    minWidth: 200,
  },
  browserPreviewLoading: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.white,
  },
  openBrowserButton: {
    marginHorizontal: 12,
    marginBottom: 12,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.iconDark,
  },
  openBrowserButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.white,
  },
});