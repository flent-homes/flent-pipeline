# Push this project to GitHub (step by step)

Do these steps **on your Mac**, in order.

## 1. Install GitHub CLI (easiest) or use the website

- **Option A — GitHub CLI:**  
  `brew install gh`  
  then `gh auth login` and follow the browser login.

- **Option B — Website only:** use [github.com/new](https://github.com/new) to create a repo (see step 3).

## 2. Open Terminal in the app folder

```bash
cd "/Users/shubhgoel/Downloads/Shubh college memories/Flent Onboarding Forms/flent-pipeline"
```

(Adjust the path if you moved the folder.)

## 3. Create an empty repo on GitHub

1. Go to [github.com/new](https://github.com/new).
2. **Repository name:** e.g. `flent-pipeline`.
3. **Private** or **Public** — your choice.
4. **Do not** add README, .gitignore, or license (this repo already has files).
5. Click **Create repository**.

Copy the repo URL GitHub shows you. It looks like:

- `https://github.com/YOUR_USERNAME/flent-pipeline.git`  
  or  
- `git@github.com:YOUR_USERNAME/flent-pipeline.git`

## 4. Stage and commit your work (if you have uncommitted changes)

```bash
git status
git add -A
git commit -m "Flent pipeline app: pipeline, agent, Sheets integration"
```

If Git says “nothing to commit”, your tree is already committed — skip to step 5.

## 5. Add GitHub as `origin` and push

**First time only** — connect your local repo to GitHub:

```bash
git remote add origin https://github.com/YOUR_USERNAME/flent-pipeline.git
```

Replace `YOUR_USERNAME` and repo name with yours.

**Push:**

```bash
git branch -M main
git push -u origin main
```

(Use SSH URL instead of `https` if you use SSH keys.)

---

## 6. Confirm on GitHub

Refresh the repo page; you should see your files.

## 7. (Optional) Deploy on Vercel

1. Import repo → [vercel.com/new](https://vercel.com/new).
2. If the GitHub repo **only contains** `flent-pipeline` at the root, leave **Root Directory** empty.
3. Add env vars from [SETUP.md](./SETUP.md#production-deploy-vercel--recommended).
4. Deploy.

---

## If `git remote add` fails with “remote origin already exists”

```bash
git remote -v
git remote set-url origin https://github.com/YOUR_USERNAME/flent-pipeline.git
git push -u origin main
```
