import type { CuratableTrack } from './curator'

const API_URL = 'https://api.spotify.com/v1'
const ACCOUNTS_URL = 'https://accounts.spotify.com'
const TOKEN_KEY = 'playlist-studio.spotify-token'
const VERIFIER_KEY = 'playlist-studio.pkce-verifier'
const STATE_KEY = 'playlist-studio.oauth-state'

export const SPOTIFY_SCOPES = [
  'playlist-read-private',
  'playlist-modify-private',
  'playlist-modify-public',
  'user-read-private',
].join(' ')

type SpotifyToken = {
  accessToken: string
  refreshToken: string
  expiresAt: number
}

type SpotifyArtist = {
  id: string
  name: string
}

type SpotifyTrack = {
  id: string | null
  uri: string
  name: string
  artists: SpotifyArtist[]
  album?: {
    name: string
    images: Array<{ url: string }>
  }
  is_local?: boolean
}

type Page<T> = {
  items: T[]
  next: string | null
}

type PlaylistItem = {
  added_at: string | null
  item?: SpotifyTrack
  track?: SpotifyTrack
}

export type SpotifyPlaylist = {
  id: string
  name: string
  description: string
  owner: { id: string; display_name?: string }
  images: Array<{ url: string }>
  external_urls: { spotify: string }
  snapshot_id: string
  tracks?: { total: number }
  items?: { total: number }
}

export type SpotifyUser = {
  id: string
  display_name?: string
  images?: Array<{ url: string }>
}

function redirectUri() {
  return new URL(import.meta.env.BASE_URL, window.location.origin).toString()
}

function randomString(length: number) {
  const alphabet =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~'
  const values = crypto.getRandomValues(new Uint8Array(length))
  return Array.from(values, (value) => alphabet[value % alphabet.length]).join('')
}

async function codeChallenge(verifier: string) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(verifier),
  )

  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replaceAll('=', '')
    .replaceAll('+', '-')
    .replaceAll('/', '_')
}

export async function beginSpotifyLogin(clientId: string) {
  const verifier = randomString(96)
  const state = randomString(32)
  sessionStorage.setItem(VERIFIER_KEY, verifier)
  sessionStorage.setItem(STATE_KEY, state)

  const url = new URL('/authorize', ACCOUNTS_URL)
  url.search = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri(),
    scope: SPOTIFY_SCOPES,
    code_challenge_method: 'S256',
    code_challenge: await codeChallenge(verifier),
    state,
  }).toString()
  window.location.assign(url)
}

async function requestToken(body: URLSearchParams) {
  const response = await fetch(`${ACCOUNTS_URL}/api/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })

  if (!response.ok) throw new Error('Spotify authorization failed. Please log in again.')
  return response.json() as Promise<{
    access_token: string
    refresh_token?: string
    expires_in: number
  }>
}

function saveToken(response: {
  access_token: string
  refresh_token?: string
  expires_in: number
}, previousRefreshToken = '') {
  const token: SpotifyToken = {
    accessToken: response.access_token,
    refreshToken: response.refresh_token ?? previousRefreshToken,
    expiresAt: Date.now() + response.expires_in * 1000,
  }
  localStorage.setItem(TOKEN_KEY, JSON.stringify(token))
  return token
}

export async function completeSpotifyLogin(clientId: string) {
  const params = new URLSearchParams(window.location.search)
  const code = params.get('code')
  if (!code) return false

  const returnedState = params.get('state')
  const expectedState = sessionStorage.getItem(STATE_KEY)
  const verifier = sessionStorage.getItem(VERIFIER_KEY)
  if (!returnedState || returnedState !== expectedState || !verifier) {
    throw new Error('Spotify login state could not be verified. Please try again.')
  }

  const response = await requestToken(
    new URLSearchParams({
      client_id: clientId,
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri(),
      code_verifier: verifier,
    }),
  )
  saveToken(response)
  sessionStorage.removeItem(VERIFIER_KEY)
  sessionStorage.removeItem(STATE_KEY)
  window.history.replaceState({}, document.title, redirectUri())
  return true
}

export function hasSpotifySession() {
  return Boolean(localStorage.getItem(TOKEN_KEY))
}

export function clearSpotifySession() {
  localStorage.removeItem(TOKEN_KEY)
}

function readToken() {
  const stored = localStorage.getItem(TOKEN_KEY)
  return stored ? (JSON.parse(stored) as SpotifyToken) : null
}

export class SpotifyClient {
  private readonly clientId: string

  constructor(clientId: string) {
    this.clientId = clientId
  }

  private async accessToken() {
    const token = readToken()
    if (!token) throw new Error('Log in with Spotify to continue.')
    if (token.expiresAt > Date.now() + 60_000) return token.accessToken
    if (!token.refreshToken) throw new Error('Your Spotify session expired. Please log in again.')

    const response = await requestToken(
      new URLSearchParams({
        client_id: this.clientId,
        grant_type: 'refresh_token',
        refresh_token: token.refreshToken,
      }),
    )
    return saveToken(response, token.refreshToken).accessToken
  }

  private async request<T>(pathOrUrl: string, init?: RequestInit): Promise<T> {
    const response = await fetch(
      pathOrUrl.startsWith('http') ? pathOrUrl : `${API_URL}${pathOrUrl}`,
      {
        ...init,
        headers: {
          Authorization: `Bearer ${await this.accessToken()}`,
          ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
          ...init?.headers,
        },
      },
    )

    if (response.status === 429) {
      throw new Error('Spotify rate limit reached. Wait a moment and try again.')
    }
    if (!response.ok) {
      const details = (await response.json().catch(() => null)) as
        | { error?: { message?: string } }
        | null
      throw new Error(details?.error?.message ?? `Spotify request failed (${response.status}).`)
    }
    return response.json() as Promise<T>
  }

  private async allPages<T>(path: string) {
    const items: T[] = []
    let next: string | null = path
    while (next) {
      const page: Page<T> = await this.request<Page<T>>(next)
      items.push(...page.items)
      next = page.next
    }
    return items
  }

  getCurrentUser() {
    return this.request<SpotifyUser>('/me')
  }

  getPlaylist(id: string) {
    return this.request<SpotifyPlaylist>(`/playlists/${id}`)
  }

  async getPlaylistTracks(id: string) {
    const items = await this.allPages<PlaylistItem>(
      `/playlists/${id}/items?limit=50&additional_types=track`,
    )

    return items.flatMap(({ item, track, added_at }) => {
      const spotifyTrack = item ?? track
      return spotifyTrack && !spotifyTrack.is_local
        ? [toCuratableTrack(spotifyTrack, added_at ?? undefined)]
        : []
    })
  }

  getArtist(id: string) {
    return this.request<SpotifyArtist & { images: Array<{ url: string }> }>(
      `/artists/${id}`,
    )
  }

  async getArtistTracks(id: string) {
    const albums = await this.allPages<{ id: string }>(
      `/artists/${id}/albums?include_groups=album,single&limit=10`,
    )
    const uniqueAlbumIds = [...new Set(albums.map((album) => album.id))]
    const albumTracks = await Promise.all(
      uniqueAlbumIds.map((albumId) =>
        this.allPages<SpotifyTrack>(`/albums/${albumId}/tracks?limit=50`),
      ),
    )

    return albumTracks
      .flat()
      .filter((track) => track.artists.some((artist) => artist.id === id))
      .map((track) => toCuratableTrack(track))
  }

  async replacePlaylist(id: string, tracks: CuratableTrack[]) {
    const chunks = [tracks.slice(0, 100), tracks.slice(100, 200)]
    await this.request(`/playlists/${id}/items`, {
      method: 'PUT',
      body: JSON.stringify({ uris: chunks[0].map((track) => track.uri) }),
    })
    if (chunks[1].length) await this.addTracks(id, chunks[1])
  }

  async addTracks(id: string, tracks: CuratableTrack[]) {
    for (let index = 0; index < tracks.length; index += 100) {
      await this.request(`/playlists/${id}/items`, {
        method: 'POST',
        body: JSON.stringify({
          uris: tracks.slice(index, index + 100).map((track) => track.uri),
        }),
      })
    }
  }
}

function toCuratableTrack(track: SpotifyTrack, addedAt?: string): CuratableTrack {
  return {
    id: track.id ?? track.uri,
    uri: track.uri,
    name: track.name,
    artists: track.artists.map((artist) => artist.name),
    albumName: track.album?.name ?? '',
    imageUrl: track.album?.images[0]?.url,
    addedAt,
  }
}

export function spotifyIdFromUrl(value: string, type: 'playlist' | 'artist') {
  const trimmed = value.trim()
  const uriMatch = trimmed.match(new RegExp(`^spotify:${type}:([A-Za-z0-9]+)$`))
  if (uriMatch) return uriMatch[1]

  try {
    const url = new URL(trimmed)
    if (url.hostname !== 'open.spotify.com') return null
    const match = url.pathname.match(new RegExp(`^/${type}/([A-Za-z0-9]+)`))
    return match?.[1] ?? null
  } catch {
    return null
  }
}