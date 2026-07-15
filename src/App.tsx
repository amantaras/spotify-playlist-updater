import { useEffect, useState } from 'react'
import {
  ArrowUpRight,
  Check,
  CircleAlert,
  Disc3,
  ExternalLink,
  ListMusic,
  LoaderCircle,
  LogIn,
  LogOut,
  Music2,
  RefreshCw,
  Shuffle,
  Sparkles,
  Trash2,
  UserRound,
} from 'lucide-react'
import {
  buildCuration,
  latestMissingTracks,
  uniqueTracks,
  type CuratableTrack,
} from './curator'
import {
  beginSpotifyLogin,
  clearSpotifySession,
  completeSpotifyLogin,
  hasSpotifySession,
  SpotifyClient,
  spotifyIdFromUrl,
  type SpotifyPlaylist,
  type SpotifyUser,
} from './spotify'
import './App.css'

const CLIENT_ID_KEY = 'playlist-studio.client-id'
const SAVED_MIXES_KEY = 'playlist-studio.saved-mixes'
type PreviewMode = 'curate' | 'latest'

type SavedMix = {
  id: string
  targetName: string
  sourceName: string
  artistName: string
  targetUrl: string
  sourceUrl: string
  artistUrl: string
  maximumSongs: number
  artistSongCount: number
}

type Preview = {
  mode: PreviewMode
  tracks: CuratableTrack[]
  target: SpotifyPlaylist
  source: SpotifyPlaylist
  artistName?: string
  sourceCount: number
  artistCount: number
}

function App() {
  const configuredClientId = import.meta.env.VITE_SPOTIFY_CLIENT_ID as
    | string
    | undefined
  const [clientId, setClientId] = useState(
    configuredClientId ?? localStorage.getItem(CLIENT_ID_KEY) ?? '',
  )
  const [authenticated, setAuthenticated] = useState(hasSpotifySession())
  const [user, setUser] = useState<SpotifyUser | null>(null)
  const [targetUrl, setTargetUrl] = useState('')
  const [sourceUrl, setSourceUrl] = useState('')
  const [artistUrl, setArtistUrl] = useState('')
  const [maximumSongs, setMaximumSongs] = useState(200)
  const [artistSongCount, setArtistSongCount] = useState(20)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [savedMixes, setSavedMixes] = useState<SavedMix[]>(readSavedMixes)
  const [confirmUpdateAll, setConfirmUpdateAll] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<
    { kind: 'error' | 'success'; message: string } | null
  >(null)

  useEffect(() => {
    if (!clientId) return
    const client = new SpotifyClient(clientId)

    async function restoreSession() {
      try {
        if (new URLSearchParams(window.location.search).has('code')) {
          setBusy('Completing Spotify login')
          await completeSpotifyLogin(clientId)
          setAuthenticated(true)
        }
        if (hasSpotifySession()) setUser(await client.getCurrentUser())
      } catch (error) {
        setNotice({ kind: 'error', message: errorMessage(error) })
        clearSpotifySession()
        setAuthenticated(false)
      } finally {
        setBusy(null)
      }
    }

    void restoreSession()
  }, [clientId])

  async function login() {
    const normalizedClientId = clientId.trim()
    if (!normalizedClientId) {
      setNotice({ kind: 'error', message: 'Enter your Spotify Client ID first.' })
      return
    }
    localStorage.setItem(CLIENT_ID_KEY, normalizedClientId)
    await beginSpotifyLogin(normalizedClientId)
  }

  function logout() {
    clearSpotifySession()
    setAuthenticated(false)
    setUser(null)
    setPreview(null)
  }

  function ids() {
    const targetId = spotifyIdFromUrl(targetUrl, 'playlist')
    const sourceId = spotifyIdFromUrl(sourceUrl, 'playlist')
    const artistId = spotifyIdFromUrl(artistUrl, 'artist')
    if (!targetId) throw new Error('Enter a valid target Spotify playlist URL.')
    if (!sourceId) throw new Error('Enter a valid source Spotify playlist URL.')
    return { targetId, sourceId, artistId }
  }

  async function loadBase(client: SpotifyClient) {
    const { targetId, sourceId, artistId } = ids()
    const currentUser = user ?? (await client.getCurrentUser())
    const [target, source] = await Promise.all([
      client.getPlaylist(targetId),
      client.getPlaylist(sourceId),
    ])
    if (target.owner.id !== currentUser.id) {
      throw new Error('The target playlist must be owned by the logged-in account.')
    }
    return { targetId, sourceId, artistId, target, source }
  }

  async function prepareCuration() {
    if (!clientId) return
    setBusy('Building randomized preview')
    setNotice(null)
    try {
      const client = new SpotifyClient(clientId)
      const base = await loadBase(client)
      if (!base.artistId) throw new Error('Enter a valid Spotify artist URL.')
      const [sourceTracks, artistTracks, artist] = await Promise.all([
        client.getPlaylistTracks(base.sourceId),
        client.getArtistTracks(base.artistId),
        client.getArtist(base.artistId),
      ])
      const tracks = buildCuration({
        sourceTracks,
        artistTracks,
        maximumSongs,
        artistSongCount,
      })
      setPreview({
        mode: 'curate',
        tracks,
        target: base.target,
        source: base.source,
        artistName: artist.name,
        sourceCount: sourceTracks.length,
        artistCount: artistTracks.length,
      })
      saveMix({
        id: base.targetId,
        targetName: base.target.name,
        sourceName: base.source.name,
        artistName: artist.name,
        targetUrl,
        sourceUrl,
        artistUrl,
        maximumSongs,
        artistSongCount,
      })
    } catch (error) {
      setNotice({ kind: 'error', message: errorMessage(error) })
    } finally {
      setBusy(null)
    }
  }

  async function prepareLatest() {
    if (!clientId) return
    setBusy('Finding the latest missing songs')
    setNotice(null)
    try {
      const client = new SpotifyClient(clientId)
      const base = await loadBase(client)
      const [sourceTracks, targetTracks] = await Promise.all([
        client.getPlaylistTracks(base.sourceId),
        client.getPlaylistTracks(base.targetId),
      ])
      const availableSlots = Math.max(0, 200 - uniqueTracks(targetTracks).length)
      const tracks = latestMissingTracks(sourceTracks, targetTracks).slice(
        0,
        availableSlots,
      )
      setPreview({
        mode: 'latest',
        tracks,
        target: base.target,
        source: base.source,
        sourceCount: sourceTracks.length,
        artistCount: 0,
      })
      if (!tracks.length) {
        setNotice({
          kind: 'success',
          message:
            availableSlots === 0
              ? 'The target already has 200 songs. Remove songs before adding more.'
              : 'The target already contains the latest songs from the source.',
        })
      }
    } catch (error) {
      setNotice({ kind: 'error', message: errorMessage(error) })
    } finally {
      setBusy(null)
    }
  }

  async function applyPreview() {
    if (!clientId || !preview?.tracks.length) return
    setBusy(preview.mode === 'curate' ? 'Replacing playlist' : 'Adding new songs')
    setNotice(null)
    try {
      const client = new SpotifyClient(clientId)
      if (preview.mode === 'curate') {
        await client.replacePlaylist(preview.target.id, preview.tracks)
      } else {
        await client.addTracks(preview.target.id, preview.tracks)
      }
      setNotice({
        kind: 'success',
        message: `${preview.target.name} was updated with ${preview.tracks.length} songs.`,
      })
      setPreview(null)
    } catch (error) {
      setNotice({ kind: 'error', message: errorMessage(error) })
    } finally {
      setBusy(null)
    }
  }

  function saveMix(mix: SavedMix) {
    const next = [mix, ...savedMixes.filter((saved) => saved.id !== mix.id)]
    localStorage.setItem(SAVED_MIXES_KEY, JSON.stringify(next))
    setSavedMixes(next)
    setConfirmUpdateAll(false)
  }

  function loadSavedMix(mix: SavedMix) {
    setTargetUrl(mix.targetUrl)
    setSourceUrl(mix.sourceUrl)
    setArtistUrl(mix.artistUrl)
    setMaximumSongs(mix.maximumSongs)
    setArtistSongCount(mix.artistSongCount)
    setPreview(null)
    setNotice(null)
  }

  function removeSavedMix(id: string) {
    const next = savedMixes.filter((mix) => mix.id !== id)
    localStorage.setItem(SAVED_MIXES_KEY, JSON.stringify(next))
    setSavedMixes(next)
    setConfirmUpdateAll(false)
  }

  async function updateAllMixes() {
    if (!clientId || !savedMixes.length) return
    if (!confirmUpdateAll) {
      setConfirmUpdateAll(true)
      setNotice({
        kind: 'error',
        message: `This will replace ${savedMixes.length} target playlist${savedMixes.length === 1 ? '' : 's'}. Press confirm to continue.`,
      })
      return
    }

    setNotice(null)
    setConfirmUpdateAll(false)
    const client = new SpotifyClient(clientId)
    let activeMix = savedMixes[0]
    try {
      const currentUser = user ?? (await client.getCurrentUser())
      for (const [index, mix] of savedMixes.entries()) {
        activeMix = mix
        setBusy(`Updating ${index + 1}/${savedMixes.length}: ${mix.targetName}`)
        const targetId = spotifyIdFromUrl(mix.targetUrl, 'playlist')
        const sourceId = spotifyIdFromUrl(mix.sourceUrl, 'playlist')
        const artistId = spotifyIdFromUrl(mix.artistUrl, 'artist')
        if (!targetId || !sourceId || !artistId) {
          throw new Error('Saved Spotify URLs are no longer valid.')
        }
        const [target, sourceTracks, artistTracks] = await Promise.all([
          client.getPlaylist(targetId),
          client.getPlaylistTracks(sourceId),
          client.getArtistTracks(artistId),
        ])
        if (target.owner.id !== currentUser.id) {
          throw new Error('The target is not owned by the logged-in account.')
        }
        await client.replacePlaylist(
          targetId,
          buildCuration({
            sourceTracks,
            artistTracks,
            maximumSongs: mix.maximumSongs,
            artistSongCount: mix.artistSongCount,
          }),
        )
      }
      setNotice({
        kind: 'success',
        message: `Updated all ${savedMixes.length} saved playlists successfully.`,
      })
    } catch (error) {
      setNotice({
        kind: 'error',
        message: `Stopped at ${activeMix.targetName}: ${errorMessage(error)}`,
      })
    } finally {
      setBusy(null)
    }
  }

  if (!authenticated) {
    return (
      <AuthScreen
        clientId={clientId}
        setClientId={setClientId}
        configured={Boolean(configuredClientId)}
        busy={busy}
        notice={notice}
        onLogin={login}
      />
    )
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href={import.meta.env.BASE_URL}>
          <span className="brand-mark"><Disc3 size={20} /></span>
          Playlist Studio
        </a>
        <div className="account">
          <span className="account-avatar">
            {user?.images?.[0] ? <img src={user.images[0].url} alt="" /> : <UserRound size={16} />}
          </span>
          <span>{user?.display_name ?? user?.id ?? 'Spotify account'}</span>
          <button className="icon-button" type="button" onClick={logout} title="Log out"><LogOut size={17} /></button>
        </div>
      </header>

      <main className="workspace">
        <aside className="control-panel">
          <div className="section-heading">
            <span>01</span>
            <div><p>Playlist inputs</p><h1>Build the mix</h1></div>
          </div>

          <label>
            <span>Target playlist</span><small>The playlist you own and want to update</small>
            <div className="input-wrap"><ListMusic size={17} /><input value={targetUrl} onChange={(event) => setTargetUrl(event.target.value)} placeholder="https://open.spotify.com/playlist/..." /></div>
          </label>
          <label>
            <span>Source playlist</span><small>Music to pull into the target</small>
            <div className="input-wrap"><Music2 size={17} /><input value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} placeholder="https://open.spotify.com/playlist/..." /></div>
          </label>
          <label>
            <span>Required artist</span><small>Artist catalog to weave into the mix</small>
            <div className="input-wrap"><UserRound size={17} /><input value={artistUrl} onChange={(event) => setArtistUrl(event.target.value)} placeholder="https://open.spotify.com/artist/..." /></div>
          </label>

          <div className="number-grid">
            <label><span>Maximum songs</span><input type="number" min="1" max="200" value={maximumSongs} onChange={(event) => setMaximumSongs(clamp(Number(event.target.value), 1, 200))} /></label>
            <label><span>Artist songs</span><input type="number" min="1" max={maximumSongs} value={artistSongCount} onChange={(event) => setArtistSongCount(clamp(Number(event.target.value), 1, maximumSongs))} /></label>
          </div>

          <button className="primary-button" type="button" onClick={prepareCuration} disabled={Boolean(busy)}>
            {busy ? <LoaderCircle className="spin" size={18} /> : <Shuffle size={18} />} Preview randomized mix
          </button>

          <div className="latest-action">
            <div><strong>Catch up from source</strong><p>Add its latest 10 missing songs without rebuilding.</p></div>
            <button className="secondary-button" type="button" onClick={prepareLatest} disabled={Boolean(busy)}><RefreshCw size={16} /> Latest 10</button>
          </div>

          <section className="saved-mixes">
            <div className="saved-heading">
              <div><strong>Saved playlists</strong><p>Loaded automatically after a successful preview.</p></div>
              <span>{savedMixes.length}</span>
            </div>
            {savedMixes.length ? (
              <>
                <div className="saved-list">
                  {savedMixes.map((mix) => (
                    <div className="saved-row" key={mix.id}>
                      <button type="button" onClick={() => loadSavedMix(mix)}>
                        <ListMusic size={16} />
                        <span><strong>{mix.targetName}</strong><small>From {mix.sourceName} + {mix.artistName}</small></span>
                      </button>
                      <button className="remove-mix" type="button" onClick={() => removeSavedMix(mix.id)} title={`Forget ${mix.targetName}`}><Trash2 size={15} /></button>
                    </div>
                  ))}
                </div>
                <button className={`update-all-button${confirmUpdateAll ? ' confirm' : ''}`} type="button" onClick={updateAllMixes} disabled={Boolean(busy)}>
                  <RefreshCw size={16} /> {confirmUpdateAll ? `Confirm update ${savedMixes.length}` : 'Update all playlists'}
                </button>
              </>
            ) : <p className="saved-empty">Preview a randomized mix to remember it here.</p>}
          </section>
        </aside>

        <section className="preview-panel">
          {notice && <Notice {...notice} />}
          {busy ? (
            <div className="empty-state"><LoaderCircle className="spin" size={42} /><h2>{busy}</h2><p>Reading Spotify's catalog and checking for duplicates.</p></div>
          ) : preview ? (
            <PreviewPane preview={preview} onApply={applyPreview} />
          ) : (
            <div className="empty-state">
              <span className="empty-icon"><Sparkles size={28} /></span>
              <p className="eyebrow">Ready when you are</p>
              <h2>A clean playlist starts with a preview.</h2>
              <p>Connect a target, a source, and an artist. Nothing changes on Spotify until you review and confirm.</p>
              <div className="guardrails"><span><Check size={15} /> No duplicate tracks</span><span><Check size={15} /> 200 song maximum</span><span><Check size={15} /> Random final order</span></div>
            </div>
          )}
        </section>
      </main>
    </div>
  )
}

function AuthScreen({ clientId, setClientId, configured, busy, notice, onLogin }: {
  clientId: string
  setClientId: (value: string) => void
  configured: boolean
  busy: string | null
  notice: { kind: 'error' | 'success'; message: string } | null
  onLogin: () => void
}) {
  return (
    <main className="auth-screen">
      <div className="auth-brand"><span className="brand-mark"><Disc3 size={20} /></span> Playlist Studio</div>
      <section className="auth-copy">
        <p className="eyebrow">Spotify playlist curator</p>
        <h1>Your sources.<br />Your artist.<br /><em>A better shuffle.</em></h1>
        <p className="auth-description">Curate up to 200 songs from a source playlist and a required artist, remove duplicates, then send the randomized result directly to Spotify.</p>
        <div className="auth-stats"><span><strong>200</strong> song cap</span><span><strong>0</strong> duplicates</span><span><strong>PKCE</strong> secure login</span></div>
      </section>
      <section className="login-panel">
        <span className="step">Connect account</span><h2>Open your Spotify library</h2>
        <p>Playlist Studio requests only the permissions needed to read and update your playlists.</p>
        {!configured && <label><span>Spotify Client ID</span><input value={clientId} onChange={(event) => setClientId(event.target.value)} placeholder="Paste the Client ID from your Spotify app" /><small>Not your email or username. Create an app in the Developer Dashboard and copy its Client ID. This public identifier stays in your browser.</small></label>}
        {notice && <Notice {...notice} />}
        <button className="spotify-button" type="button" onClick={onLogin} disabled={Boolean(busy)}>{busy ? <LoaderCircle className="spin" size={19} /> : <LogIn size={19} />}{busy ?? 'Log in with Spotify'}</button>
        <a href="https://developer.spotify.com/dashboard" target="_blank" rel="noreferrer">Spotify Developer Dashboard <ArrowUpRight size={14} /></a>
      </section>
      <div className="record-grooves" aria-hidden="true"><Disc3 /></div>
    </main>
  )
}

function PreviewPane({ preview, onApply }: { preview: Preview; onApply: () => void }) {
  return (
    <div className="preview-content">
      <div className="preview-header">
        <div><p className="eyebrow">{preview.mode === 'curate' ? 'Randomized mix' : 'Latest missing'}</p><h2>{preview.tracks.length} songs ready</h2><p>For <strong>{preview.target.name}</strong> from {preview.source.name}{preview.artistName ? ` + ${preview.artistName}` : ''}.</p></div>
        <a className="icon-button" href={preview.target.external_urls.spotify} target="_blank" rel="noreferrer" title="Open target playlist"><ExternalLink size={18} /></a>
      </div>
      <div className="mix-metrics"><span><strong>{preview.sourceCount}</strong> source songs scanned</span><span><strong>{preview.artistCount}</strong> artist songs found</span><span><strong>{preview.tracks.length}</strong> unique songs selected</span></div>
      <div className="track-list">
        {preview.tracks.map((track, index) => (
          <div className="track-row" key={track.id}>
            <span className="track-number">{String(index + 1).padStart(2, '0')}</span>
            <span className="track-art">{track.imageUrl ? <img src={track.imageUrl} alt="" /> : <Music2 size={17} />}</span>
            <span className="track-title"><strong>{track.name}</strong><small>{track.artists.join(', ')}</small></span>
            <span className="album-name">{track.albumName}</span>
          </div>
        ))}
      </div>
      <div className="commit-bar"><div><CircleAlert size={17} /><p>{preview.mode === 'curate' ? 'Confirming replaces the target playlist with this exact order.' : 'Confirming appends these songs to the target playlist.'}</p></div><button className="primary-button" type="button" onClick={onApply}><Check size={18} /> Confirm update</button></div>
    </div>
  )
}

function Notice({ kind, message }: { kind: 'error' | 'success'; message: string }) {
  return <div className={`notice ${kind}`}>{kind === 'error' ? <CircleAlert size={17} /> : <Check size={17} />}<span>{message}</span></div>
}

function clamp(value: number, minimum: number, maximum: number) {
  if (!Number.isFinite(value)) return minimum
  return Math.min(maximum, Math.max(minimum, value))
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.'
}

function readSavedMixes(): SavedMix[] {
  try {
    const stored = localStorage.getItem(SAVED_MIXES_KEY)
    return stored ? (JSON.parse(stored) as SavedMix[]) : []
  } catch {
    return []
  }
}

export default App