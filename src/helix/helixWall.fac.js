module.exports = [ 'ENGINE', function ( ENGINE ) {

	var allPosters = new THREE.Object3D();
	ENGINE.$$.scene.add( allPosters );

	function makeHelixPosters( posterObjectMulti ) {

		var vector = new THREE.Vector3();

		for ( var i = 0 ; i < posterObjectMulti.length; i ++ ) {
			var elem = document.createElement( 'div' );
			elem.className = 'posterElem';
			elem.style.backgroundImage = "url('http://image.tmdb.org/t/p/w154/" + posterObjectMulti[i].poster_path + "')";
			elem.style.width = '150px';
			elem.style.height = '230px';
			var css3dObj = new THREE.CSS3DObject( elem );

			var phi = i * 0.175 + Math.PI;
			var rr = 900;
			css3dObj.position.x = -rr * Math.sin( phi );
			css3dObj.position.y = -( i * 8 ) + 200;
			css3dObj.position.z = rr * Math.cos( phi );

			vector.x = -css3dObj.position.x * 2;
			vector.y = css3dObj.position.y;
			vector.z = -css3dObj.position.z * 2;
			// vector.multiplyScalar( -1 );

			css3dObj.lookAt( vector );

			allPosters.add( css3dObj );
		}
		console.log( 'c', allPosters.children.length );

	}

	function clearAllPosters() {
		console.log( 'b', allPosters.children.length );
		for ( var i = 0; i < allPosters.children.length; i ++ ) {
			allPosters.children[i].disposeElement();
		}
		allPosters.children = [];
		console.log( 'a', allPosters.children.length );
	}

	return {
		makeHelixPosters,
		clearAllPosters
	};

} ];
