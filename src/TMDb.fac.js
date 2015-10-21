module.exports = [ 'log', '$http', 'TMDB_API', 'EVT', '$cacheFactory', '$q', 'ENDPOINT_URI',
function ( log, $http, TMDB_API, EVT, $cacheFactory, $q, ENDPOINT_URI ) {

	var searchResult = [];
	var prevResultLen = 0;
	var totalPages = -1;
	var currPage = 1;

	var movieIdCache = $cacheFactory( 'movieIdCache' );
	// TMDB_API.url + 'movie/now_playing'

	var DB_ENDPOINT = ENDPOINT_URI + 'movie/';

	function putItemToDB( movieItem ) {
		// todo dont put exisiting item in db ( UPSERT )
		$http.put( DB_ENDPOINT + movieItem.id, movieItem )
		.then( function ( res ) {
			log.debug( 'info', 'PUT:', res );
		}, function ( err ) {
			log.debug( 'err', 'PUT:', err );
		} );
	}

	function searchIdFromDB( id ) {
		var promise = $http.get( DB_ENDPOINT + id )
		.then( function ( res ) {
			log.debug( 'info', 'searchById => DB:', res.data );
			if ( res.data ) {
				return res.data;
			} else {
				return null;
			}
		}, function( err ) {
			log.debug( 'err', 'searchById => DB:', err );
		} );
		return promise;
	}

	function searchIdFromAPI( id ) {
		var promise = $http.get( TMDB_API.url + 'movie/' + id, {
			params: { api_key: TMDB_API.key }
		} ).then( function ( res ) {
			log.debug( 'info', 'searchById => API:', res.data );
			movieIdCache.put( res.data.id, res.data );
			putItemToDB( res.data );
			return res.data;
		}, function ( err ) {
			log.debug( 'err', 'searchById => API:', err );
		} );
		return promise;
	}

	function searchById( id ) {

		var cachedItem = movieIdCache.get( id );
		if ( cachedItem ) {
			log.debug( 'info', 'searchById => cache:', cachedItem );
			return cachedItem;
		}

		var df_DB = $q.defer();
		var df_Res = $q.defer();

		searchIdFromDB( id ).then( function ( res ) {
			if ( res ) {
				df_DB.resolve( res );
			} else {
				df_DB.reject( 'not found' );
			}
		}, function ( err ) {
				df_DB.reject( err );
		} );

		df_DB.promise.then( function ( res_DB ) {
			df_Res.resolve( res_DB );
		}, function ( err ) {
			searchIdFromAPI( id ).then( function ( res_api ) {
				df_Res.resolve( res_api );
			}, function ( err_api ) {
				df_Res.reject( err_api );
			} );
		} );

		return df_Res.promise;

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
			log.debug( 'info', 'searchByTitle:', res, res.data );

			// cache
			res.data.results.forEach( function ( item ) {

				if ( !movieIdCache.get( item.id ) ) {
					movieIdCache.put( item.id, item );
					// putItemToDB( item ); // todo check if already exits in DB
				}

			} );

		}, function ( err ) {
			// emit event search err
			log.debug( 'searchByTitle:', err );
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
		prevResultLen,
		putItemToDB
	};

} ];
