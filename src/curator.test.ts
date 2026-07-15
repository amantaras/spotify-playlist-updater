import { describe, expect, it } from 'vitest'
import {
  buildCuration,
  latestMissingTracks,
  type CuratableTrack,
} from './curator'

const track = (id: string, addedAt?: string): CuratableTrack => ({
  id,
  uri: `spotify:track:${id}`,
  name: `Track ${id}`,
  artists: ['Artist'],
  albumName: 'Album',
  addedAt,
})

describe('buildCuration', () => {
  it('includes artist tracks, removes duplicates, and caps the playlist at 200', () => {
    const source = Array.from({ length: 210 }, (_, index) => track(`source-${index}`))
    source.push(track('artist-1'))

    const result = buildCuration({
      sourceTracks: source,
      artistTracks: [track('artist-1'), track('artist-2'), track('artist-2')],
      maximumSongs: 250,
      artistSongCount: 2,
      random: () => 0.5,
    })

    expect(result).toHaveLength(200)
    expect(new Set(result.map(({ id }) => id)).size).toBe(200)
    expect(result.map(({ id }) => id)).toEqual(
      expect.arrayContaining(['artist-1', 'artist-2']),
    )
  })
})

describe('latestMissingTracks', () => {
  it('returns at most ten newest source tracks that are absent from the target', () => {
    const source = Array.from({ length: 12 }, (_, index) =>
      track(`${index}`, `2026-01-${String(index + 1).padStart(2, '0')}T00:00:00Z`),
    )

    const result = latestMissingTracks(source, [track('11'), track('10')])

    expect(result).toHaveLength(10)
    expect(result[0].id).toBe('9')
    expect(result.at(-1)?.id).toBe('0')
  })
})