**VibeSeek 1.0.1** — Windows (x64) 与 macOS (Apple Silicon) 安装包。

本次更新主要是 **macOS 适配**:标题栏让开红绿灯交通灯、输入框支持 ⌘C / ⌘V / ⌘X / ⌘A、补全菜单栏与 ⌘K / ⌘⇧D 快捷键;macOS 下「改动备份与一键回滚」现已可正常使用。此外还解决了一些已知问题。

> ⚠️ **未签名提示**:应用暂未做代码签名。
> - Windows:首次运行 SmartScreen 可能提示"已保护你的电脑",点「更多信息」→「仍要运行」即可。
> - macOS:首次打开请右键点「打开」,或在「系统设置 → 隐私与安全性」中允许;也可执行 `xattr -dr com.apple.quarantine /Applications/VibeSeek.app`。

### 校验完整性

下载后比对 `SHA256SUMS.txt` 中的哈希:

```powershell
# Windows (PowerShell)
Get-FileHash .\VibeSeek-Setup-*.exe -Algorithm SHA256
```

```bash
# macOS
shasum -a 256 VibeSeek-*-arm64.dmg
```
