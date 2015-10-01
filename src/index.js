angular.module( 'app', [] )

.controller( 'mainCtrl', [ '$scope', 'MD', function ( $scope, MD )  {

	window.SCOPE = $scope;
	var vm = this;

	vm.movieItems = null;
	MD.req();
	$scope.$watch( MD.getRes, function ( res ) {
		if ( res ) vm.movieItems = res.results;
	}, true );

} ] )
.directive( 'movieItem', [ 'MD', function ( MD ) {

	function ctrl( $scope, $element ) {

	}

	return {
		restrict: 'E',
		replace: true,
		scope: {
			mv: '='
		},
		controller: ctrl,
		controllerAs: 'mvItem',
		templateUrl: 'src/template/mvItem.html'
	};

} ] )
.factory( 'MD', [ '$http',  function ( $http ) {

	var API_KEY = '374c0342a6406dfe0aeb3de2ea042c59';
	var url = {
		search: 'http://api.themoviedb.org/3/search/movie'
	};
	var searchResult = null;

	function req() {

		$http({
			method: 'GET',
			url: url.search,
			params:{
				api_key: API_KEY,
				query: 'maze'
			}
		}).success( function( res ) {
			searchResult = res;
			console.log( res );
		} ).error( function ( err ) {
			console.error( err );
		} );

	}

	function getRes() {
		return searchResult;
	}

	return {
		req,
		getRes
	};

} ] )
;
