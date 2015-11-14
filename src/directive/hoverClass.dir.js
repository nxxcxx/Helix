module.exports = [ function () {

	function link( $scope, $element, $attrs ) {

		$element
		.on( 'mouseenter', function () {
			$element.removeClass( $attrs.leave );
			$element.addClass( $attrs.hover );
		} )
		.on( 'mouseleave', function () {
			$element.removeClass( $attrs.hover );
			$element.addClass( $attrs.leave );
		} );

	}

	return {
		restrict: 'A',
		link: link
	};

} ];
