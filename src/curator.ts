export type CuratableTrack = {
  id: string
  uri: string
  name: string
  artists: string[]
  albumName: string
  imageUrl?: string
  addedAt?: string
}

export function uniqueTracks(tracks: CuratableTrack[]) {
  const seen = new Set<string>()

  return tracks.filter((track) => {
    if (!track.id || !track.uri || seen.has(track.id)) return false
    seen.add(track.id)
    return true
  })
}

export function shuffleTracks(
  tracks: CuratableTrack[],
  random: () => number = Math.random,
) {
  const shuffled = [...tracks]

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1))
    ;[shuffled[index], shuffled[swapIndex]] = [
      shuffled[swapIndex],
      shuffled[index],
    ]
  }

  return shuffled
}

type BuildCurationOptions = {
  sourceTracks: CuratableTrack[]
  artistTracks: CuratableTrack[]
  maximumSongs: number
  artistSongCount: number
  random?: () => number
}

export function buildCuration({
  sourceTracks,
  artistTracks,
  maximumSongs,
  artistSongCount,
  random = Math.random,
}: BuildCurationOptions) {
  const cappedMaximum = Math.min(200, Math.max(1, maximumSongs))
  const selectedArtistTracks = shuffleTracks(uniqueTracks(artistTracks), random).slice(
    0,
    Math.min(artistSongCount, cappedMaximum),
  )
  const artistIds = new Set(selectedArtistTracks.map((track) => track.id))
  const selectedSourceTracks = shuffleTracks(uniqueTracks(sourceTracks), random)
    .filter((track) => !artistIds.has(track.id))
    .slice(0, cappedMaximum - selectedArtistTracks.length)

  return shuffleTracks([...selectedArtistTracks, ...selectedSourceTracks], random)
}

export function latestMissingTracks(
  sourceTracks: CuratableTrack[],
  targetTracks: CuratableTrack[],
  count = 10,
) {
  const targetIds = new Set(targetTracks.map((track) => track.id))

  return uniqueTracks(sourceTracks)
    .filter((track) => !targetIds.has(track.id))
    .sort(
      (left, right) =>
        Date.parse(right.addedAt ?? '') - Date.parse(left.addedAt ?? ''),
    )
    .slice(0, count)
}