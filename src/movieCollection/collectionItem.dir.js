module.exports = [ 'log', 'TMDb', function ( log, TMDb ) {

	function ctrl( $scope, $attrs, $element ) {

		TMDb.searchById( parseInt( $scope.movieId ) )
		.then( function ( res ) {

			// log.debug( 'info', 'collectionItemDirective', res );
			var imgUrl = 'http://image.tmdb.org/t/p/w154/' + res.poster_path;
			$element.css( {
				'width': '100%',
				'height': '100%',
				'background-repeat': 'no-repeat',
				'background-size': '100% 100%',
				'background-image': 'url(' + imgUrl + ')'
			} );

		}, function ( err ) {
			log.debug( 'err', 'collectionItemDirective', err );
		} );

	}

	return {
		restrict: 'E',
		replace: true,
		scope: { movieId: '@' },
		controller: ctrl,
		controllerAs: 'ci',
		template: '<div></div>'
	};

} ];
