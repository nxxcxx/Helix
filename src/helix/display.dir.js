module.exports = [ '$window', 'ENGINE', 'util', function ( $window, ENGINE, util ) {

	function ctrl( $scope, $element ) {

		ENGINE.attachRenderer( $( $element[0] ) );
		$( $window )
			.on( 'resize', util.debounce( ENGINE.onWindowResize, 100 ) )
			.on( 'wheel', function ( evt ) { ENGINE.$$.wheel_dy = -Math.sign( evt.originalEvent.deltaY ); } )
		;
		ENGINE.start();

	}

	return {
		restrict: 'E',
		replace: true,
		controller: ctrl,
		template: '<div id="canvas-container"></div>'
	};

} ];
