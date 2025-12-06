import AbstractSource from './abstract.js'

export default new class NyaaSi extends AbstractSource {
  base = 'https://torrent-search-api-livid.vercel.app/api/nyaasi/'

  /** @type {import('./').SearchFunction} */
  async single({ titles, episode, season }) {
    if (!titles?.length) return []

    // 1. Run all fetches in parallel for better performance
    const promises = titles.map(async (rawTitle) => {
      try {
        const title = this.fixTitle(rawTitle, season)
        const query = this.buildQuery(title, season, episode)
        const url = `${this.base}${encodeURIComponent(query)}`

        console.log(url)
        
        const res = await fetch(url)
        if (!res.ok) return [] // Handle HTTP errors gracefully
        
        const json = await res.json()
        return Array.isArray(json) ? json : []
      } catch (err) {
        console.error('Nyaa search failed for:', rawTitle, err)
        return []
      }
    })

    // 2. Wait for all requests to finish
    const results = await Promise.all(promises)

    // 3. Flatten the array of arrays into a single list
    const flatData = results.flat()

    if (!flatData.length) return []

    return this.map(flatData)
  }

  fixTitle(title) {
    const match1 = title.match(/(\d)(?:nd|rd|th) Season/i)
    const match2 = title.match(/Season (\d)/i)

    if (match2) {
      return title.replace(/Season \d/i, `S${match2[1]}`)
    } else if (match1) {
      return title.replace(/(\d)(?:nd|rd|th) Season/i, `S${match1[1]}`)
    }
    
    // CRITICAL FIX: Return original title if no regex matches
    return title
  }

  /** @type {import('./').SearchFunction} */
  batch = this.single
  movie = this.single

  buildQuery(title, season, episode) {
    // Ensure title is a string before replacing
    let query = (title || '').replace(/[^\w\s-]/g, ' ').trim()
    if (season) query += ` S${season.toString().padStart(2, '0')}`
    if (episode) query += `E${episode.toString().padStart(2, '0')}`
    return query
  }

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
      // Encode the query to ensure the URL is valid
      const res = await fetch(this.base + encodeURIComponent('one piece'))
      return res.ok
    } catch {
      return false
    }
  }
}()
