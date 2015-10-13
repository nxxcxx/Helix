module.exports = [ 'ENGINE', '$compile', '$rootScope', function ( ENGINE, $compile, $rootScope ) {

	var allPosters = new THREE.Object3D();
	ENGINE.$$.scene.add( allPosters );

	function makeHelixPosters( posterObjectMulti, offsetStartIdx ) {

		for ( var i = 0; i < posterObjectMulti.length; i++ ) {

			var $isolatedScope = $rootScope.$new( true );
			$isolatedScope.movieItem = posterObjectMulti[ i ];

			// $isolatedScope.$on( '$destroy', function () {
			// 	console.log( 'scope destroyed' );
			// } );

			var posterDirectiveElem = $compile( '<poster></poster>' )( $isolatedScope )[ 0 ];
			var css3dObj = new THREE.CSS3DObject( posterDirectiveElem );

			// tag alog an isolatedScope to be destroy when dispose an element
			css3dObj.scope = $isolatedScope;

			var hidx = i + offsetStartIdx;
			var phi = hidx * 0.175 + Math.PI;
			var rr = 900;
			css3dObj.position.x = - rr * Math.sin( phi );
			css3dObj.position.y = - ( hidx * 8 ) + 200;
			css3dObj.position.z = rr * Math.cos( phi );

			var vector = new THREE.Vector3( -css3dObj.position.x * 2, css3dObj.position.y, -css3dObj.position.z * 2);

			css3dObj.lookAt( vector );
			allPosters.add( css3dObj );

		}

		console.log( 'current:', allPosters.children.length );

	}

	function clearAll() {
		for ( var i = 0; i < allPosters.children.length; i++ ) {
			var poster = allPosters.children[ i ];
			poster.disposeElement();
			poster.scope.$destroy();
		}
		allPosters.children.length = 0; // clear items
	}

	return {
		makeHelixPosters,
		clearAll
	};

} ];
