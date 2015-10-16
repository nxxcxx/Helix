module.exports = [ '$window', function ( $window ) {

	var $$ = {
		canvas: null,
		stats: new Stats(),
		scene: new THREE.Scene(),
		width: $window.innerWidth,
		height: $window.innerHeight,
		camera: new THREE.PerspectiveCamera( 70, this.width / this.height, 10, 100000 ),
		renderer: new THREE.CSS3DRenderer(),
		screen_ratio: this.width / this.height,
		pixel_ratio: $window.devicePixelRatio || 1,
		mouse_x: this.width * 0.5,
		mouse_y: this.height * 0.5,
		wheel_dy: 0
	};

	$$.renderer.setSize( $$.width, $$.height );

	function attachRenderer( canvas ) {
		$$.canvas = canvas;
		canvas.append( $$.renderer.domElement );
		canvas.append( $$.stats.domElement );
	}

	function onWindowResize() {
		$$.width = $window.innerWidth;
		$$.height = $window.innerHeight;
		$$.pixel_ratio = $window.devicePixelRatio || 1;
		$$.screen_ratio = $$.width / $$.height;
		$$.camera.aspect = $$.screen_ratio;
		$$.camera.updateProjectionMatrix();
		$$.renderer.setSize( $$.width, $$.height );
	}

	function setup() {

	}

	function update() {

		if ( Math.abs( $$.wheel_dy ) > 0.001 ) {
			$$.camera.position.y += $$.wheel_dy * 1.0;
			$$.camera.rotateY( $$.wheel_dy * 0.025 );
			$$.wheel_dy *= 0.95;
		}

	}

	// ----  draw loop
	function run() {

		requestAnimationFrame( run );
		update();
		$$.renderer.render( $$.scene, $$.camera );
		$$.stats.update();

	}

	function start() {
		setup();
		run();
	}

	function resetCamera() {
		$$.camera.position.set( 0, 0, 0 );
		$$.camera.rotation.set( 0, 0, 0 );
	}

	return {
		$$,
		attachRenderer,
		onWindowResize,
		start,
		resetCamera,
	};

} ];
