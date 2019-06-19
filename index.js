const { config, persist } = require('internal')
const pUrl = require('url')
const needle = require('needle')
const cheerio = require('cheerio')

const defaults = {
	name: 'IPTV Web Player',
	prefix: 'iptvwebplayer_',
	origin: '',
	endpoint: '',
	icon: 'http://www.mdcgate.com/apps/upload/images/tvos_iptv/IPTV-tvOS-icon.jpg',
	categories: []
}


let categories = []
let catalogs = []
const channels = {}
let token, cookies, origin, endpoint, ajaxEndpoint

const headers = {
	'Accept': 'text/plain, */*; q=0.01',
	'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
	'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_13_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/73.0.3683.86 Safari/537.36',
	'X-Requested-With': 'XMLHttpRequest'
}

function setEndpoint(str) {
	if (str) {
		let host = str
		if (host.endsWith('/index.php'))
			host = host.replace('/index.php', '/')
		if (!host.endsWith('/'))
			host += '/'
		endpoint = host
		origin = endpoint.replace(pUrl.parse(endpoint).path, '')
		ajaxEndpoint = endpoint + 'includes/ajax-control.php'
		headers['Origin'] = origin
		headers['Referer'] = endpoint + 'index.php'
	}
	return true
}

function setCatalogs(cats) {
	if (config.style == 'Channels') {
		categories = cats
		return true
	} else if (config.style == 'Catalogs') {
		categories = cats
		catalogs = []
		cats.forEach(cat => {
			catalogs.push({
				id: defaults.prefix + 'cat_' + cat.id,
				name: cat.name,
				type: 'tv',
				extra: [ { name: 'search' } ]
			})
		})
		return true
	}
}

let loggedIn = false

// not using logout anywhere yet
function logout(cb) {
	const payload = 'action=logoutProcess'
	needle.post(ajaxEndpoint, payload, { headers, cookies }, (err, resp, body) => {
		if (!err) {
			loggedIn = false
			cookies = undefined
			cb(true)
		} else
			cb()
	})
}

setEndpoint(config.host)

function isLogedIn(cb) {
	if (loggedIn)
		return cb(true)

	const payload = 'action=webtvlogin&uname='+config.username+'&upass='+config.password+'&rememberMe=off'
	needle.post(ajaxEndpoint, payload, { headers, cookies }, (err, resp, body) => {
		cookies = resp.cookies
		if (body) {
			if (typeof body == 'string') {
				try {
					body = JSON.parse(body)
				} catch(e) {
					console.log(defaults.name + ' - Error')
					console.error(e.message || 'Unable to parse JSON response from ' + defaults.name + ' server')
				}
			}
			if (body.result == 'error') {
				console.log(defaults.name + ' - Error')
				console.error(body.message || 'Failed to log in')
				cb()
			} else if (body.result == 'success') {
				const msg = (body.message || {})
				if (msg.max_connections && msg.active_cons >= msg.max_connections) {
					console.log(defaults.name + ' - Error')
					console.error('Too many connections to ' + defaults.name + ' server, stop a connection and restart add-on')
					cb(false)
				} else {
					// login success
					loggedIn = true
					console.log(defaults.name + ' - Logged In')
					persist.setItem('loginData', msg)
					getCategories(success => {
						if (success)
							console.log(defaults.name + ' - Updated catalogs successfully')
						else
							console.log(defaults.name + ' - Could not update catalogs from server')

						cb(true)
					})
				}
			} else {
				console.log(defaults.name + ' - Error')
				console.error('Unknown response from server')
				cb()
			}
		} else {
			console.log(defaults.name + ' - Error')
			console.error('Invalid response from server')
			cb()
		}
	})
}

function request(url, payload, cb) {
	isLogedIn(() => { needle.post(url, payload, { headers, cookies }, cb) })
}

function findChannel(query, chans) {
	const results = []
	chans.forEach(chan => {
		if (chan.name.toLowerCase().includes(query.toLowerCase()))
			results.push(chan)
	})
	return results
}

function findMeta(id) {
	const idParts = id.split('_')
	const catId = idParts[1]
	let meta
	channels[catId].some(chan => {
		if (chan.id == id) {
			meta = chan
			return true
		}
	})
	return meta
}

function getCatalog(reqId, cb) {
	setEndpoint(config.host)
	const id = reqId.replace(defaults.prefix + 'cat_', '')
	if (channels[id] && channels[id].length)
		cb(channels[id])
	else {
		const payload = 'action=getStreamsFromID&categoryID=' + id + '&hostURL=' + encodeURIComponent('http://' + persist.getItem('loginData').url + ':' + persist.getItem('loginData').port + '/')
		request(ajaxEndpoint, payload, (err, resp, body) => {
			if (!err && body) {
				const $ = cheerio.load(body)
				channels[id] = []

				$('li.streamList').each((ij, el) => {
					const elem = $(el)
					let poster = $(el).find('img').attr('src')
					if (poster.startsWith('images/'))
						poster = endpoint + poster
					channels[id].push({
						id: defaults.prefix + id + '_' + elem.find('.streamId').attr('value'),
						type: 'tv',
						name: elem.find('label').text().trim(),
						poster, background: poster, logo: poster,
						posterShape: 'square'
					})
				})

				cb(channels[id])
			} else
				cb(false)
		})
	}
}

function getVideos(reqId, cb) {
	const id = reqId.replace(defaults.prefix + 'meta_', '')
	if (channels[id] && channels[id].length)
		cb(channels[id])
	else {
		const payload = 'action=getStreamsFromID&categoryID=' + id + '&hostURL=' + encodeURIComponent('http://' + persist.getItem('loginData').url + ':' + persist.getItem('loginData').port + '/')
		request(ajaxEndpoint, payload, (err, resp, body) => {
			if (!err && body) {
				const $ = cheerio.load(body)
				channels[id] = []

				$('li.streamList').each((ij, el) => {
					const elem = $(el)
					let poster = $(el).find('img').attr('src')
					if (poster.startsWith('images/'))
						poster = endpoint + poster
					channels[id].push({
						id: defaults.prefix + 'video_' + elem.find('.streamId').attr('value'),
						name: elem.find('label').text().trim()
					})
				})

				cb(channels[id])
			} else
				cb(false)
		})
	}
}

function addZero(deg) {
	return ('0' + deg).slice(-2)
}

function getCategories(cb) {
	const date = new Date()
	const payload = 'dateFullData=' + (date.getDay() +1) + '-' + (date.getMonth() +1) + '-' + date.getFullYear() + '+' + encodeURIComponent(addZero(date.getHours()) + ":" + addZero(date.getMinutes()) + ":" + addZero(date.getSeconds()))
	needle.post(endpoint + 'live.php', payload, { headers, cookies }, (err, resp, body) => {
		if (!err && body) {
			const $ = cheerio.load(body)
			const results = []
			$('.cbp-spmenu li a').each((ij, el) => {
				const elm = $(el)
				if (config.style == 'Channels')
					results.push({
						name: elm.text().trim(),
						id: defaults.prefix + 'meta_' + elm.attr('data-categoryid'),
						type: 'channel',
						posterShape: 'square'
					})
				else if (config.style == 'Catalogs')
					results.push({ name: elm.text().trim(), id: elm.attr('data-categoryid') })
			})
			if (results.length) {
				setCatalogs(results)
				cb(true)
			} else
				cb(false)
		} else
			cb(false)
	})
}

function retrieveManifest() {
	function manifest() {
		const types = ['tv']
		if (config.style == 'Channels') {
			types.push('channel')
			catalogs.push({
				id: defaults.prefix + 'catalog',
				name: 'Web Portal IPTV',
				type: 'tv'
			})
		}
		return {
			id: 'org.' + defaults.name.toLowerCase().replace(/[^a-z]+/g,''),
			version: '1.0.0',
			name: defaults.name,
			description: 'Creates catalogs or channels based on IPTV Web Portals. Connects to the Web Portal used by many IPTV Providers (Nitro, Beast, Twisted and many more)',
			resources: ['stream', 'meta', 'catalog'],
			types,
			idPrefixes: [defaults.prefix],
			icon: defaults.icon,
			catalogs
		}
	}

	return new Promise((resolve, reject) => {
		isLogedIn(() => { resolve(manifest()) })
	})
}

async function retrieveRouter() {
	const manifest = await retrieveManifest()

	const { addonBuilder, getInterface, getRouter } = require('stremio-addon-sdk')

	const builder = new addonBuilder(manifest)

	builder.defineCatalogHandler(args => {
		return new Promise((resolve, reject) => {
			if (config.style == 'Channels') {
				isLogedIn(() => {
					if (categories.length)
						resolve({ metas: categories })
					else
						reject(defaults.name + ' - Invalid catalog response')
				})
			} else if (config.style == 'Catalogs') {
				const extra = args.extra || {}
				getCatalog(args.id, catalog => {
					if (catalog) {
						let results = catalog
						if (extra.search)
							results = findChannel(extra.search, catalog)
						if (results.length)
							resolve({ metas: results })
						else
							reject(defaults.name + ' - No results for catalog request')
					} else
						reject(defaults.name + ' - Invalid catalog response')
				})
			}
		})
	})

	builder.defineMetaHandler(args => {
		return new Promise((resolve, reject) => {
			if (config.style == 'Channels') {
				let meta

				categories.forEach(el => {
					if (el.id == args.id) {
						meta = el
						return true
					}
				})
				if (!meta)
					reject(defaults.name + ' - Could not find meta')
				else
					getVideos(args.id, videos => {
						if (videos.length)
							meta.videos = videos
						resolve({ meta })
					})
			} else if (config.style == 'Catalogs') {
				const meta = findMeta(args.id)
				if (!meta) reject(defaults.name + ' - Could not get meta')
				else resolve({ meta })
			}
		})
	})

	builder.defineStreamHandler(args => {
		return new Promise((resolve, reject) => {
			const chanId = args.id.split('_')[2]
			const url = 'http://' + persist.getItem('loginData').url + ':' + persist.getItem('loginData').port + '/live/' + config.username + '/' + config.password + '/' + chanId + '.m3u8'
			resolve({ streams: [ { title: 'Stream', url } ] })
		})
	})

	const addonInterface = getInterface(builder)

	return getRouter(addonInterface)

}

module.exports = retrieveRouter()

