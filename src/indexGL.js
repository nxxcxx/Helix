// 'use strict';

var CANVAS, STATS;
var SCENE, CAMERA, CAMERA_CTRL, RENDERER;
var WIDTH = window.innerWidth;
var HEIGHT = window.innerHeight;
var PIXEL_RATIO = window.devicePixelRatio || 1;
var SCREEN_RATIO = WIDTH / HEIGHT;
var MOUSE_X = WIDTH * 0.5;
var MOUSE_Y = HEIGHT * 0.5;
var WHEEL_DY = 0;

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
CAMERA = new THREE.PerspectiveCamera( 60, window.innerWidth / window.innerHeight, 10, 100000 );
// ---- Camera orbit controls
// CAMERA_CTRL = new THREE.OrbitControls( CAMERA, CANVAS );
// CAMERA_CTRL.object.position.z = 600;
// CAMERA_CTRL.update();
// global.cam = CAMERA_CTRL;
global.cam = CAMERA;
// ---- Renderer
RENDERER = new THREE.CSS3DRenderer();
RENDERER.setSize( WIDTH, HEIGHT );
CANVAS.appendChild( RENDERER.domElement );
// ---- Stats
STATS = new Stats();
CANVAS.appendChild( STATS.domElement );

function main() {

}

function update() {

	// var dx = - ( ( MOUSE_X / WIDTH ) - 0.5 );
	// if ( Math.abs( dx ) > 0.4 ) {
	// 	CAMERA.rotateY( dx * 0.01 );
	// }

	//
	// var dy = - ( ( MOUSE_Y / HEIGHT ) - 0.5 );
	// if ( Math.abs( dy ) > 0.2 ) {
	// 	CAMERA.position.y += dy * 10.0;
	// }

	CAMERA.position.y += WHEEL_DY * 1.0;
	CAMERA.rotateY( WHEEL_DY * 0.025 );
	WHEEL_DY *= 0.95;

}

// ----  draw loop
function run() {

	requestAnimationFrame( run );
	// RENDERER.clear();
	update();
	RENDERER.render( SCENE, CAMERA );
	STATS.update();

}

CANVAS.addEventListener( 'mousemove', function ( event ) {

	MOUSE_X = event.clientX;
	MOUSE_Y = event.clientY;

} );

window.addEventListener( 'wheel', function ( event ) {

	WHEEL_DY = Math.sign( event.deltaY );

} );

window.addEventListener( 'keypress', function ( event ) {
	switch ( event.keyCode ) {
		case 119:/*w*/
			WHEEL_DY = 1.0;
			break;
		case 115:/*s*/
			WHEEL_DY = -1.0;
			break;
	}
} );

var util = require( './util.js' );
window.addEventListener( 'resize', util.debounce( onWindowResize, 50 ) );

function onWindowResize() {
	WIDTH = window.innerWidth;
	HEIGHT = window.innerHeight;
	PIXEL_RATIO = window.devicePixelRatio || 1;
	SCREEN_RATIO = WIDTH / HEIGHT;
	CAMERA.aspect = SCREEN_RATIO;
	CAMERA.updateProjectionMatrix();
	RENDERER.setSize( WIDTH, HEIGHT );
}



main();
run();

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
