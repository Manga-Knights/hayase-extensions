// nyaa-si.js

import AbstractSource from './abstract.js'

export default new class NyaaSi extends AbstractSource {
  base = 'https://nyaa.si/?page=rss&c=1_2&f=0&q='

  // --- CRITICAL CONSTANT ---
  COUR_EPISODE_OFFSET = 12
  // -------------------------

  /** @type {import('./').SearchFunction} */
  async single({ titles, episode, exclusions, fetch }) {
    if (!navigator.onLine) return []
    if (!titles?.length) return []

    // 1. Generate the base search parameter sets (handling Cour and S01 fallback)
    const baseSearchSets = []
    titles.forEach((rawTitle) => {
      const searchSets = this.fixTitle(rawTitle, episode)
      baseSearchSets.push(...searchSets)
    })

    // 2. Expand each base search set into multiple query formats
    const allSearchQueries = []
    baseSearchSets.forEach(baseSet => {
      allSearchQueries.push(...this.generateQueries(baseSet))
    })

    // 3. Execute all generated searches in parallel
    const promises = allSearchQueries.map(async ({ title, episode, season, notation }) => {
      try {
        const query = this.buildQuery(title, episode, season, notation)
        const url = `${this.base}${encodeURIComponent(query)}`

        const res = await fetch(url)
        if (!res.ok) return []

        const text = await res.text()
        return this.parseRSS(text)
      } catch {
        return []
      }
    })

    const results = await Promise.all(promises)
    const flatData = results.flat()

    if (!flatData.length) return []

    // 4. Deduplicate by hash (multiple queries may return the same torrent)
    const seen = new Set()
    const unique = flatData.filter(item => {
      if (!item.hash || seen.has(item.hash)) return false
      seen.add(item.hash)
      return true
    })

    // 5. Apply exclusions filter
    return unique.filter(item =>
      !exclusions?.some(excluded =>
        item.title.toLowerCase().includes(excluded.toLowerCase())
      )
    )
  }

  /** @type {import('./').SearchFunction} */
  batch = this.single
  movie = this.single

  /**
   * Parses a Nyaa.si RSS XML response into torrent result objects.
   */
  parseRSS(xmlText) {
    const parser = new DOMParser()
    const doc = parser.parseFromString(xmlText, 'application/xml')
    const items = doc.querySelectorAll('item')
    const results = []

    items.forEach(item => {
      const get = tag => item.querySelector(tag)?.textContent?.trim() ?? ''
      const getNyaa = tag => item.getElementsByTagNameNS('https://nyaa.si/xmlns/nyaa', tag)[0]?.textContent?.trim() ?? ''

      const title = get('title')
      const link = get('link')
      const pubDate = get('pubDate')
      const hash = getNyaa('infoHash')
      const seeders = getNyaa('seeders')
      const leechers = getNyaa('leechers')
      const downloads = getNyaa('downloads')
      const size = getNyaa('size')
      const trusted = getNyaa('trusted')

      results.push({
        title,
        link,
        hash,
        seeders: parseInt(seeders || '0'),
        leechers: parseInt(leechers || '0'),
        downloads: parseInt(downloads || '0'),
        size: this.parseSize(size),
        date: new Date(pubDate),
        accuracy: trusted === 'Yes' ? 'high' : 'medium'
      })
    })

    return results
  }

  /**
   * Generates multiple query objects (formats) from a single search parameter set.
   */
  generateQueries(baseSet) {
    const queries = []

    // 1. Standard Query (Title + Sxx + xx)
    queries.push({ ...baseSet, notation: 'STANDARD' })

    // 2. Explicit Episode Query (Title + Sxx + Exx)
    if (baseSet.season) {
      queries.push({ ...baseSet, notation: 'S_E' })
    }

    // 3. Simple Episode Query (Title + Exx)
    queries.push({ ...baseSet, notation: 'E' })

    return queries
  }

  fixTitle(rawTitle, episode) {
    let workingTitle = rawTitle
    let season = null
    const baseEpisode = episode
    const searchResults = []

    // --- COUR DETECTION ---
    const courRegex = /\s*(Cour|Part)\s*(\d+)/i
    const courMatch = workingTitle.match(courRegex)

    if (courMatch) {
      const courNum = parseInt(courMatch[2])
      workingTitle = workingTitle.replace(courMatch[0], '').trim()

      if (courNum === 2) {
        // Search A (Cour 2 as Season S02)
        searchResults.push({
          title: workingTitle,
          episode: baseEpisode,
          season: courNum.toString().padStart(2, '0'),
          originalQuery: rawTitle
        })

        // Search B (Episode Offset)
        searchResults.push({
          title: workingTitle,
          episode: baseEpisode + this.COUR_EPISODE_OFFSET,
          season: null,
          originalQuery: rawTitle
        })
        return searchResults
      }
    }

    // --- SEASON DETECTION ---
    const seasonRegex = /(?:(\d+)(?:st|nd|rd|th)?\s*Season)|(?:Season\s*(\d+))|(?:\s[sS](\d+))/i
    const seasonMatch = workingTitle.match(seasonRegex)

    if (seasonMatch) {
      const seasonNum = seasonMatch[1] || seasonMatch[2] || seasonMatch[3]
      if (seasonNum) {
        season = seasonNum
        workingTitle = workingTitle.replace(seasonMatch[0], '').trim()
      }
    }

    // --- FINAL SEARCH GENERATION AND SEASON 1 FALLBACK ---

    // 1. Primary Search: Uses extracted Season or no Season tag
    searchResults.push({
      title: workingTitle || rawTitle,
      episode: baseEpisode,
      season: season ? season.padStart(2, '0') : null,
      originalQuery: rawTitle
    })

    // 2. Fallback Search (Only if NO Season was detected)
    if (!season) {
      searchResults.push({
        title: workingTitle || rawTitle,
        episode: baseEpisode,
        season: '01',
        originalQuery: rawTitle
      })
    }

    return searchResults
  }

  /**
   * Builds the search query based on the requested notation format.
   * @param {string} title
   * @param {number} episode
   * @param {string|null} season
   * @param {string} notation - 'STANDARD', 'E', or 'S_E'
   */
  buildQuery(title, episode, season, notation) {
    let query = (title || '').replace(/[^\w\s-]/g, ' ').trim()

    const paddedEpisode = episode.toString().padStart(2, '0')
    const paddedSeason = season ? season.padStart(2, '0') : null

    if (notation === 'S_E' && paddedSeason) {
      query += ` S${paddedSeason}E${paddedEpisode}`
    } else if (notation === 'E') {
      query += ` E${paddedEpisode}`
    } else {
      // STANDARD: Title Sxx xx
      if (paddedSeason) query += ` S${paddedSeason}`
      query += ` ${paddedEpisode}`
    }

    return query
  }

  parseSize(sizeStr) {
    if (!sizeStr) return 0

    const match = sizeStr.match(/([\d.]+)\s*(KiB|MiB|GiB|KB|MB|GB)/i)
    if (!match) return 0

    const value = parseFloat(match[1])
    const unit = match[2].toUpperCase()

    switch (unit) {
      case 'KIB':
      case 'KB': return value * 1024
      case 'MIB':
      case 'MB': return value * 1024 * 1024
      case 'GIB':
      case 'GB': return value * 1024 * 1024 * 1024
      default: return 0
    }
  }

  async test() {
    try {
      const res = await fetch(`${this.base}${encodeURIComponent('one piece')}`)
      if (!res.ok) throw new Error(`Nyaa.si returned ${res.status}. Is the site down?`)
      const text = await res.text()
      if (!text.includes('<channel>')) throw new Error('Nyaa.si returned an unexpected response. Is the site down?')
      return true
    } catch (err) {
      throw new Error(`Could not reach Nyaa.si! ${err.message ?? 'Is your internet connection working?'}`)
    }
  }
}()