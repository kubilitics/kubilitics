/* eslint-disable react-refresh/only-export-components */
/**
 * Apple-style toast notifications powered by Sonner.
 *
 * Design language: macOS/iOS system notifications
 *  - Bottom-right positioning (macOS notification centre)
 *  - SF Pro-equivalent font stack (system-ui)
 *  - Vibrancy glass: solid bg with subtle shadow (WebKit-safe)
 *  - No visible border — pure layered shadow
 *  - Coloured leading stripe per semantic type (success/error/warning/info)
 *  - Compact, information-dense layout
 *  - Spring-in, slide-right-out animation
 *
 * All visual styles live in index.css (global stylesheet) — NOT in an
 * inline <style> tag — to guarantee they are parsed before the first
 * toast renders. This is critical for Tauri's WKWebView where component-
 * injected <style> tags can race with toast rendering.
 */
import { Toaster as Sonner, toast } from "sonner";
import { useThemeStore } from "@/stores/themeStore";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme, resolvedTheme } = useThemeStore();
  const effectiveTheme = theme === 'system' ? resolvedTheme : theme;
  return (
    <Sonner
      position="bottom-right"
      theme={effectiveTheme}
      offset={24}
      gap={8}
      visibleToasts={3}
      closeButton
      richColors={false}
      toastOptions={{
        duration: 3500,
        classNames: {
          toast: "apple-toast",
        },
      }}
      style={{ zIndex: 999999999 }}
      {...props}
    />
  );
};

export { Toaster, toast };
