# Kubilitics Desktop Installation Guide

## Download

Download the latest release from the [GitHub Releases](https://github.com/kubilitics/kubilitics/releases) page.

## Installation Instructions

### macOS

1. **Download** the `.dmg` file from the releases page
2. **Open** the downloaded `.dmg` file
3. **Drag** `Kubilitics.app` to your Applications folder
4. **First Launch**: macOS may show a security warning because the app is unsigned (open-source project)

   **To bypass the warning, choose one:**
   
   **Option A (Recommended):**
   - Right-click `Kubilitics.app` → **Open**
   - Click **Open** in the security dialog
   - The app will launch and be added to your allowed apps
   
   **Option B (Terminal):**
   ```bash
   xattr -dr com.apple.quarantine /Applications/Kubilitics.app
   ```
   Then launch normally from Applications.

### Windows

1. **Download** the `.msi` installer from the releases page
2. **Run** the installer
3. **If Windows SmartScreen appears:**
   - Click **"More info"**
   - Click **"Run anyway"**
   - Complete the installation

   **Note:** This warning appears because the installer is unsigned (open-source project). The app is safe to install.

### Linux

#### AppImage
1. **Download** the `.AppImage` file
2. **Make executable:**
   ```bash
   chmod +x Kubilitics-*.AppImage
   ```
3. **Run:**
   ```bash
   ./Kubilitics-*.AppImage
   ```

#### DEB Package (Debian/Ubuntu)
```bash
sudo dpkg -i kubilitics_*.deb
sudo apt-get install -f  # Install dependencies if needed
```

#### RPM Package (Fedora/RHEL/CentOS)
```bash
sudo rpm -i kubilitics-*.rpm
# Or with dependency resolution:
sudo dnf install kubilitics-*.rpm
```

## Why Do I See Security Warnings?

Kubilitics is an open-source project that distributes unsigned binaries (similar to projects like Headlamp). This is common for open-source software and does not indicate any security risk.

**Security warnings appear because:**
- The binaries are not code-signed (code signing certificates cost $99-400/year)
- Operating systems warn users about unsigned software as a security measure
- This is normal for open-source projects without commercial backing

**The app is safe to use** - you can review the source code on GitHub. The warnings are just OS security measures.

## Verification

After installation, verify Kubilitics is working:

1. Launch the application
2. Check that the backend starts automatically (you should see it running on port 8190)
3. Connect to your Kubernetes cluster using your kubeconfig

## Troubleshooting

### macOS: "App is damaged and can't be opened"
This usually means the quarantine attribute wasn't removed. Run:
```bash
xattr -dr com.apple.quarantine /Applications/Kubilitics.app
```

### Windows: SmartScreen blocks installation
1. Click "More info"
2. Click "Run anyway"
3. If still blocked, check Windows Defender settings

### Linux: "Permission denied"
Make sure the AppImage is executable:
```bash
chmod +x Kubilitics-*.AppImage
```

## Building from Source

If you prefer to build from source (no security warnings):

```bash
git clone https://github.com/kubilitics/kubilitics.git
cd kubilitics/kubilitics-desktop
npm install
npm run tauri build
```

See [CONTRIBUTING.md](../../CONTRIBUTING.md) for detailed build instructions.
