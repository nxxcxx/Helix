module.exports = [ function () {

	function ctrl( $scope, $element ) {

		$element.css( {
			'width': '150px',
			'height': '230px',
			'backgroundImage': 'url("http://image.tmdb.org/t/p/w154/' + $scope.movieItem.poster_path + '")'
		} );

		$element.on( 'click', function ( evt ) {
			console.log( $scope );
		} );

	}

	return {
		restrict: 'E',
		replace: true,
		controller: ctrl,
		template: '<div class="posterElem"></div>'
	};

} ];
