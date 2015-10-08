module.exports = [ 'TMDb', function ( TMDb ) {

	function ctrl( $scope, $element ) {
	}

	return {
		restrict: 'E',
		replace: true,
		scope: {
			movieItem: '='
		},
		controller: ctrl,
		controllerAs: 'mvItem',
		templateUrl: 'src/mvItem.html'
	};

} ];
