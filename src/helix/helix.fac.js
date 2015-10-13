module.exports = [ 'ENGINE', '$compile', '$rootScope', function ( ENGINE, $compile, $rootScope ) {

	var allPosters = new THREE.Object3D();
	ENGINE.$$.scene.add( allPosters );

	function makeHelixPosters( posterObjectMulti, offsetStartIdx ) {

		var vector = new THREE.Vector3();

		for ( var i = 0 ; i < posterObjectMulti.length; i ++ ) {

			var $isolatedScope = $rootScope.$new( true );
			$isolatedScope.movieItem = posterObjectMulti[i];
			var posterDirectiveElem = $compile( '<poster></poster>' )( $isolatedScope )[0];
			var css3dObj = new THREE.CSS3DObject( posterDirectiveElem );

			var hidx = i + offsetStartIdx;
			var phi = hidx * 0.175 + Math.PI;
			var rr = 900;
			css3dObj.position.x = -rr * Math.sin( phi );
			css3dObj.position.y = -( hidx * 8 ) + 200;
			css3dObj.position.z = rr * Math.cos( phi );

			vector.x = -css3dObj.position.x * 2;
			vector.y = css3dObj.position.y;
			vector.z = -css3dObj.position.z * 2;

			css3dObj.lookAt( vector );
			allPosters.add( css3dObj );

		}

		console.log( 'current:', allPosters.children.length );

	}

	function clearAll() {
		console.log( 'before clear:', allPosters.children.length );
		for ( var i = 0; i < allPosters.children.length; i ++ ) {
			allPosters.children[i].disposeElement();
		}
		allPosters.children = [];
		console.log( 'after clear:', allPosters.children.length );
	}

	return {
		makeHelixPosters,
		clearAll
	};

} ];
