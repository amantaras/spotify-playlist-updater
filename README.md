# Playlist Studio

A browser-based Spotify playlist curator. It can:

- Build a randomized target playlist from another playlist and a required artist.
- Select how many artist songs to include.
- Remove duplicate Spotify tracks and enforce a maximum of 200 songs.
- Preview every change before replacing the target playlist.
- Append up to the latest 10 source songs that are missing from the target.
- Remember complete target/source/artist configurations for quick access.
- Update every saved playlist sequentially with a confirmation step.
- Manage playlists from a dashboard with add, edit, update, Spotify link, and delete actions.
- Verify target, source, and artist identities with Spotify names, artwork, owners, and song counts before saving.
- Persist target, source, and artist artwork for quick dashboard recognition.
- Log in securely with Spotify Authorization Code + PKCE, without a client secret.

## Spotify setup

1. Create an app in the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard).
2. Add `http://127.0.0.1:5173/` as a redirect URI for local development.
3. Copy `.env.example` to `.env.local` and set `VITE_SPOTIFY_CLIENT_ID` to the app's Client ID.
4. In Spotify development mode, add each account that will test the app under **Users Management**.

The redirect URI must match exactly, including the trailing slash. The Client ID is a public identifier; never add a Spotify Client Secret to this frontend.

## Local development

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:5173/`. The app also allows entering a Client ID in the login screen when no environment value is configured.

Run all checks with:

```bash
npm run lint
npm test
npm run build
```

## How updates work

After login, the **Playlists** dashboard is the main screen. Use **Add playlist** to create a saved target/source/artist configuration. Each dashboard row can be updated immediately, edited, opened in Spotify, or deleted. **Update all** processes every saved configuration after confirmation and reports progress and failures.

Use **Verify Spotify links** to visually confirm resources when Spotify makes them available, but verification is optional for saving a configuration. Previewing or updating always checks Spotify access again before changing a playlist.

Spotify's own clients can display Spotify's full catalog, but third-party apps have different access. Spotify removed algorithmic and Spotify-owned editorial playlists from Development Mode Web API apps on November 27, 2024. The current **Get Playlist Items** endpoint is documented as accessible only for playlists owned by the logged-in user or playlists where that user is a collaborator. Other playlists can therefore open normally in Spotify while returning `Resource not found` or `Forbidden` to this app. Copy their songs into a playlist you own and use that copied playlist as the source.

**Randomized mix** reads every track from the source playlist and the selected artist's albums and singles. It chooses the requested artist allocation first, fills the remaining capacity from the source, deduplicates by Spotify track ID, randomizes the final order, and replaces the target in batches of 100.

**Latest 10** sorts source playlist items by Spotify's `added_at` timestamp, removes tracks already in the target, and appends up to 10. If the target is close to 200 songs, only the available number of songs is added.

Only a playlist owned by the logged-in Spotify user can be selected as the target.

## GitHub CI/CD

The workflows in `.github/workflows` run lint, tests, and the production build for pull requests and pushes to `main`. Successful `main` builds deploy to GitHub Pages.

1. Push the repository to GitHub with `main` as the default branch.
2. In **Settings > Secrets and variables > Actions > Variables**, create `SPOTIFY_CLIENT_ID` with the public Spotify Client ID.
3. In **Settings > Pages**, select **GitHub Actions** as the source.
4. Add the deployed URL to Spotify's redirect allowlist, exactly as GitHub reports it. It normally looks like `https://OWNER.github.io/REPOSITORY/`.

Tagged versions create an archive and a GitHub Release after tests pass:

```bash
git tag v1.0.0
git push origin v1.0.0
```

## Spotify permissions

The app requests `playlist-read-private`, `playlist-modify-private`, `playlist-modify-public`, and `user-read-private`. Tokens and saved playlist configurations are kept in browser local storage. Logging out removes the Spotify token; saved configurations remain available for the next login.