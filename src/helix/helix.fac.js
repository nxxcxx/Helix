module.exports = [ 'log', 'ENGINE', '$compile', '$rootScope',
function ( log, ENGINE, $compile, $rootScope ) {

	var allPosters = new THREE.Object3D();
	ENGINE.$$.scene.add( allPosters );

	function makeHelixPosters( posterObjectMulti, offsetStartIdx ) {

		var vector = new THREE.Vector3();
		var radius = 900;
		for ( var i = 0; i < posterObjectMulti.length; i++ ) {

			var $isolatedScope = $rootScope.$new( true );
			$isolatedScope.movieItem = posterObjectMulti[ i ];

			var posterDirectiveElem = $compile( '<poster></poster>' )( $isolatedScope )[ 0 ];
			var css3dObj = new THREE.CSS3DObject( posterDirectiveElem );

			// tag alog an isolatedScope to be destroy when dispose an element
			css3dObj.scope = $isolatedScope;

			var hidx = i + offsetStartIdx;
			var phi = hidx * 0.175 + Math.PI;
			css3dObj.position.x = - radius * Math.sin( phi );
			css3dObj.position.y = - ( hidx * 8 ) + 200;
			css3dObj.position.z = radius * Math.cos( phi );

			vector.set( -css3dObj.position.x * 2, css3dObj.position.y, -css3dObj.position.z * 2 );

			css3dObj.lookAt( vector );
			allPosters.add( css3dObj );

		}

		log.debug( 'info', 'curr posters:', allPosters.children.length );

	}

	function clearAll() {
		allPosters.children.forEach( function ( poster ) {
			poster.disposeElement();
			poster.scope.$destroy();
		} );
		allPosters.children.length = 0; // clear items
	}

	return {
		makeHelixPosters,
		clearAll
	};

} ];
