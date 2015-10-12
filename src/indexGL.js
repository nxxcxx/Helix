// 'use strict';

var CANVAS, STATS;
var SCENE, CAMERA, CAMERA_CTRL, RENDERER;
var WIDTH = window.innerWidth;
var HEIGHT = window.innerHeight;
var PIXEL_RATIO = window.devicePixelRatio || 1;
var SCREEN_RATIO = WIDTH / HEIGHT;

// ---- Settings
var SCENE_SETTINGS = {
	bgColor: 2368557,
	enableGridHelper: true,
	enableAxisHelper: true
};

// ---- Scene
CANVAS = document.getElementById( 'canvas-container' );
SCENE = new THREE.Scene();
// ---- Camera
CAMERA = new THREE.PerspectiveCamera( 40, window.innerWidth / window.innerHeight, 10, 100000 );
// CAMERA orbit control
CAMERA_CTRL = new THREE.OrbitControls( CAMERA, CANVAS );
CAMERA_CTRL.object.position.z = 600;
CAMERA_CTRL.update();

// ---- Renderer
// RENDERER = new THREE.WebGLRenderer( {
// 	antialias: true,
// 	alpha: true
// } );


RENDERER = new THREE.CSS3DRenderer();

RENDERER.setSize( WIDTH, HEIGHT );
// RENDERER.setPixelRatio( PIXEL_RATIO );
// RENDERER.setClearColor( SCENE_SETTINGS.bgColor, 1 );
// RENDERER.autoClear = false;
CANVAS.appendChild( RENDERER.domElement );

// ---- Stats
STATS = new Stats();
CANVAS.appendChild( STATS.domElement );

//source: main.js
function main() {

}

global.makeHelixPosters = function( posterObjectMulti ) {
	var vector = new THREE.Vector3();
	var allPosters = new THREE.Object3D();
	for ( var i = 0 ; i < posterObjectMulti.length; i ++ ) {
		var elem = document.createElement( 'div' );
		elem.className = 'posterElem';
		elem.style.backgroundImage = "url('http://image.tmdb.org/t/p/w154/" + posterObjectMulti[i].poster_path + "')";
		elem.style.width = '150px';
		elem.style.height = '230px';
		// elem.textContent = 'TEST TEXT';
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
	SCENE.add( allPosters );
};

//source: run.js
function update() {

}

// ----  draw loop
function run() {

	requestAnimationFrame( run );
	// RENDERER.clear();
	update();
	RENDERER.render( SCENE, CAMERA );
	STATS.update();
	
}

//source: events.js
window.addEventListener( 'keypress', function ( event ) {
	switch ( event.keyCode ) {
		case 65:/*A*/
			break;
	}
} );

window.addEventListener( 'resize', debounce( onWindowResize, 50 ) );

function onWindowResize() {

	WIDTH = window.innerWidth;
	HEIGHT = window.innerHeight;

	PIXEL_RATIO = window.devicePixelRatio || 1;
	SCREEN_RATIO = WIDTH / HEIGHT;

	CAMERA.aspect = SCREEN_RATIO;
	CAMERA.updateProjectionMatrix();

	RENDERER.setSize( WIDTH, HEIGHT );
	RENDERER.setPixelRatio( PIXEL_RATIO );
}

//source: util.js
function debounce( func, wait, immediate ) {
	var _this = this,
		_arguments = arguments;

	var timeout;
	return function () {

		var context = _this,
			args = _arguments;
		var later = function later() {

			timeout = null;
			if ( !immediate ) func.apply( context, args );
		};
		var callNow = immediate && !timeout;
		clearTimeout( timeout );
		timeout = setTimeout( later, wait );
		if ( callNow ) func.apply( context, args );
	};
}

main();
run();
