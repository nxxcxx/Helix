module.exports = [ '$state', function ( $state ) {

	function ctrl( $scope, $element ) {

		// $scope.movieItem obj is passed thru isolatedScope via compiled directive in helix.fac.js

		var img = new Image();
		var imgUrl = 'http://image.tmdb.org/t/p/w154/' + $scope.movieItem.poster_path;
		img.onload = function () {

			// todo move css into sass, use class instead
			$element.css( {
				'width': '150px',
				'height': '230px',
				'background-repeat': 'no-repeat',
				'background-size': '150px 230px',
				'background-image': 'url(' + imgUrl + ')',
				'display': 'none' // required for fadeIn animation
			} );
			$element.fadeIn( 1500 );

		};
		img.src = imgUrl;

		$element.on( 'click', function ( evt ) {
			$state.go( 'movieDetail', { movieId: $scope.movieItem.id } );
		} );

	}

	return {
		restrict: 'E',
		replace: true,
		controller: ctrl,
		template: '<div class="posterElem"></div>'
	};

} ];
