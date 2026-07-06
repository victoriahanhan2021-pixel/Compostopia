# 部署指南（推荐：GitHub Pages + Firebase）

目标：前端发布到 GitHub Pages（公共网站），后端使用 Firebase（Auth + Firestore），并把 rules 部署到云端，先跑通 Shared Batch / Collaborators / Activity Log（不启用 Storage）。

## 1) Firebase Console 需要先启用的服务

在 Firebase Console 里确认：

- **Authentication**
  - 启用你们要用的登录方式（建议先开 Email/Password）
  - Authentication → Settings → **Authorized domains**
    - 添加：`<你的GitHub用户名>.github.io`
- **Firestore Database**
  - 创建数据库（Production/Test 都可以，先测试可用 Test，正式再收紧 rules）
  - 不启用 Storage 也可以跑通共享核心功能（照片不会共享）

## 2) 本地（你电脑）需要安装和登录 Firebase CLI

```bash
npm i -g firebase-tools
firebase login
```

## 3) 确认当前 Firebase Project（重要）

本项目已经包含：
- `firebase.json`
- `.firebaserc`

`.firebaserc` 当前默认指向 `composting-74985`。如果你们要用自己的 Firebase Project，请先把 `.firebaserc` 改成你们的项目 ID，或执行：

```bash
firebase use --add
```

## 4) 部署后端 rules（这一步会真正“上云端生效”）

```bash
firebase deploy --only firestore:rules
```

这一步会把：
- `firestore.rules`

部署到 Firebase 云端。之后 shared batch / collaborators / activity log 的访问权限才会按 rules 控制。

说明：
- 方案 A（不启用 Storage）只需要部署 Firestore rules。
- 如果未来要启用“照片共享”，再启用 Storage 并补上 Storage rules 部署。

## 5) 发布前端到 GitHub Pages

项目已经包含 GitHub Actions 自动发布：

- `.github/workflows/deploy-github-pages.yml`

你需要在 GitHub 仓库里设置：

- Settings → Pages
- Source 选择 **GitHub Actions**

然后 push 到 `main` 分支，Actions 跑完后就会生成页面 URL：
`https://<username>.github.io/<repo>/`

## 6) 最小验证流程（建议）

1. 账号 A 登录 → 创建 Shared Batch → 邀请账号 B 邮箱
2. 账号 B 登录 → dashboard 看到 shared batch
3. 账号 B 新增 daily record（结构化数据）
4. 账号 A 刷新/重新登录 → 确认 record / activity log 都同步可见
