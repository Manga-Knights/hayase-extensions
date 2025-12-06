// nyaa-si.js

import AbstractSource from './abstract.js'

export default new class NyaaSi extends AbstractSource {
  base = 'https://torrent-search-api-livid.vercel.app/api/nyaasi/'

  // --- CRITICAL CONSTANT ---
  COUR_EPISODE_OFFSET = 12 
  // -------------------------

  /** @type {import('./').SearchFunction} */
  async single({ titles, episode }) {
    if (!titles?.length) return []

    // 1. Generate the base search parameter sets (handling Cour and S01 fallback)
    const baseSearchSets = []
    titles.forEach((rawTitle) => {
        const searchSets = this.fixTitle(rawTitle, episode)
        baseSearchSets.push(...searchSets)
    })
    
    // 2. Expand each base search set into multiple query formats
    let allSearchQueries = []
    baseSearchSets.forEach(baseSet => {
        allSearchQueries.push(...this.generateQueries(baseSet));
    });
    
    // 3. Execute all generated searches in parallel
    const promises = allSearchQueries.map(async ({ title, episode, season, notation, originalQuery }) => {
      try {
        // Build the specific query format (e.g., 'S01E10' or just '10')
        const query = this.buildQuery(title, episode, season, notation)
        const url = `${this.base}${encodeURIComponent(query)}`
        
        // console.log(`Searching for: ${query}`) // Uncomment for debugging
        
        const res = await fetch(url)
        if (!res.ok) return [] 
        
        const json = await res.json()
        return Array.isArray(json) ? json : []
      } catch (err) {
        // console.error('Nyaa search failed for:', originalQuery, err)
        return []
      }
    })

    const results = await Promise.all(promises)

    const flatData = results.flat()

    if (!flatData.length) return []

    return this.map(flatData)
  }

  // --- NEW HELPER METHOD ---
  /**
   * Generates multiple query objects (formats) from a single search parameter set.
   */
  generateQueries(baseSet) {
      const queries = [];
      const { title, episode, season, originalQuery } = baseSet;

      // 1. Standard Query (Title + Sxx + xx)
      queries.push({ ...baseSet, notation: 'STANDARD' });

      // 2. Explicit Episode Query (Title + Sxx + Exx)
      if (season) {
          queries.push({ ...baseSet, notation: 'S_E' });
      }

      // 3. Simple Episode Query (Title + Exx)
      queries.push({ ...baseSet, notation: 'E' });
      
      return queries;
  }

  // fixTitle method remains the same (generates base search sets)
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
        // 1. Search A (Cour 2 as Season S02)
        searchResults.push({
            title: workingTitle,
            episode: baseEpisode,
            season: courNum.toString().padStart(2, '0'), 
            originalQuery: rawTitle 
        })
        
        // 2. Search B (Episode Offset)
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
            season: '01', // Explicitly add S01 tag
            originalQuery: rawTitle 
        })
    }
    
    return searchResults
  }

  /** @type {import('./').SearchFunction} */
  batch = this.single
  movie = this.single

  // --- UPDATED METHOD TO USE NOTATION ---
  /**
   * Builds the search query based on the requested notation format.
   * @param {string} title 
   * @param {number} episode 
   * @param {string|null} season 
   * @param {string} notation - 'STANDARD', 'E', or 'S_E'
   */
  buildQuery(title, episode, season, notation) {
    let query = (title || '').replace(/[^\w\s-]/g, ' ').trim()
    
    const paddedEpisode = episode.toString().padStart(2, '0');
    const paddedSeason = season ? season.padStart(2, '0') : null;
    
    if (notation === 'S_E' && paddedSeason) {
        // Example: Title S01E10
        query += ` S${paddedSeason}E${paddedEpisode}`;
    } else if (notation === 'E') {
        // Example: Title E10
        query += ` E${paddedEpisode}`;
    } else {
        // 'STANDARD' (Title Sxx xx) or fallback
        if (paddedSeason) query += ` S${paddedSeason}`;
        query += ` ${paddedEpisode}`;
    }
    
    return query
  }

  // map, parseSize, and test methods remain unchanged...
  map(data) {
    return data.map(item => {
      const hash = item.Magnet?.match(/btih:([a-fA-F0-9]+)/)?.[1] || ''

      return {
        title: item.Name || '',
        link: item.Magnet || '',
        hash,
        seeders: parseInt(item.Seeders || '0'),
        leechers: parseInt(item.Leechers || '0'),
        downloads: parseInt(item.Downloads || '0'),
        size: this.parseSize(item.Size || ''),
        date: new Date(item.DateUploaded),
        verified: false,
        type: 'alt',
        accuracy: 'medium'
      }
    })
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
      const res = await fetch(this.base + encodeURIComponent('one piece'))
      return res.ok
    } catch {
      return false
    }
  }
}()