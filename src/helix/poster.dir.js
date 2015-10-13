module.exports = [ function () {

	function ctrl( $scope, $element ) {

		var img = new Image();
		var imgUrl = 'http://image.tmdb.org/t/p/w154/' + $scope.movieItem.poster_path;
		img.onload = function () {

			$element.css( {
				'width': '150px',
				'height': '230px',
				'background-size': 'contain',
				'backgroundImage': 'url(' + imgUrl + ')',
				'display': 'none' // required for fadeIn animation
			} );
			$element.fadeIn( 1500 );

		};
		img.src = imgUrl;

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
