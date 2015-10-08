module.exports = [ '$http', 'TMDB_API', 'EVT',
function ( $http, TMDB_API, EVT ) {

	var searchResult = [];
	var totalPages = -1;
	var currPage = 1;

	var url = {
		searchMovie: TMDB_API.url + 'search/movie',
		searchMulti: TMDB_API.url + 'search/multi'
	};

	function req( searchObj ) {

		if ( currPage > totalPages && totalPages !== -1 ) {
			// emit event end of page
			EVT.EOP.emit();
			return;
		}

		$http( {
			method: 'GET',
			url: url.searchMovie,
			params:{
				api_key: TMDB_API.key,
				query: searchObj.query,
				page: currPage
			}
		} ).success( function ( res ) {
			// emit event search success
			searchResult = searchResult.concat( removeNoPosterItems( res.results ) );
			totalPages = res.total_pages;
			currPage ++;
			console.log( res );
		} ).error( function ( err ) {
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
		searchResult = [];
		totalPages = -1;
		currPage = 1;
	}

	return {
		req,
		clearSearch,
		getRes
	};

} ];
