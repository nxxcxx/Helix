module.exports = [ '$http', 'TMDB_API', 'EVT',
function ( $http, TMDB_API, EVT ) {

	var searchResult = [];
	var prevResultLen = 0;
	var totalPages = -1;
	var currPage = 1;

	var url = {
		searchMovie: TMDB_API.url + 'search/movie',
		searchMulti: TMDB_API.url + 'search/multi'
	};

	function request( searchObj ) {

		if ( currPage > totalPages && totalPages !== -1 ) {
			// emit event end of page
			EVT.EOP.emit();
			return;
		}

		$http( {
			method: 'GET',
			cache: true,
			url: url.searchMovie,
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
			console.log( res, res.data );
		}, function ( err ) {
			// emit event search err
			console.error( err );
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
		request,
		clearSearch,
		getRes,
		prevResultLen
	};

} ];
