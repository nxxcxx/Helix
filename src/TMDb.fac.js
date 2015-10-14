module.exports = [ 'log', '$http', 'TMDB_API', 'EVT', '$cacheFactory',
function ( log, $http, TMDB_API, EVT, $cacheFactory ) {

	var searchResult = [];
	var prevResultLen = 0;
	var totalPages = -1;
	var currPage = 1;

	var movieIdCache = $cacheFactory( 'movieIdCache' );

	function searchById( id ) {

		var cachedItem = movieIdCache.get( id );
		if ( cachedItem ) {
			log.debug( 'info', 'searchById => cache', cachedItem );
			return cachedItem;
		}

		var promise = $http( {
			method: 'GET',
			url: TMDB_API.url + 'movie/' + id,
			params: { api_key: TMDB_API.key }
		} ).then( function ( res ) {
			log.debug( 'info', 'searchById => API', res.data );
			movieIdCache.put( res.data.id, res.data );
			return res.data;
		}, function ( err ) {
			log.debug( 'err', err );
		} );

		return promise;

	}

	function searchByTitle( searchObj ) {

		if ( currPage > totalPages && totalPages !== -1 ) {
			// emit event end of page
			EVT.EOP.emit();
			return;
		}

		$http( {
			method: 'GET',
			cache: true,
			url: TMDB_API.url + 'search/movie',
			params:{
				api_key: TMDB_API.key,
				query: searchObj.query,
				page: currPage
			}
		} ).then( function ( res ) {
			// emit event search success
			searchResult = searchResult.concat( removeNoPosterItems( res.data.results ) );
			totalPages = res.data.total_pages;
			currPage ++;
			prevResultLen = searchResult.length;
			log.debug( 'info', res, res.data );

			// cache
			res.data.results.forEach( function ( item ) {
				var cachedItem = movieIdCache.get( item.id );
				if ( !cachedItem ) {
					movieIdCache.put( item.id, item );
				}
			} );

		}, function ( err ) {
			// emit event search err
			log.debug( 'err', err );
		} );

	}

	function removeNoPosterItems( results ) {
		return results.filter( function ( item ) {
			return !!item.poster_path;
		} );
	}

	function getRes() {
		return searchResult;
	}

	function clearSearch() {
		// emit event clearSeach
		searchResult.length = 0;
		prevResultLen = 0;
		totalPages = -1;
		currPage = 1;
	}

	return {
		searchByTitle,
		searchById,
		clearSearch,
		getRes,
		prevResultLen
	};

} ];
