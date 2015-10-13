angular.module( 'app', [
	'ui.router'
] )

.constant( 'TMDB_API', {
	key: '374c0342a6406dfe0aeb3de2ea042c59',
	url: 'http://api.themoviedb.org/3/'
} )

.factory( 'util', require( './util.js' ) )
.controller( 'mainCtrl', require( './main.ctrl.js' ) )
.factory( 'TMDb', require( './TMDb.fac.js' ) )
.factory( 'EVT', require( './events.fac.js' ) )
.directive( 'display', require( './helix/display.dir.js' ) )
.factory( 'ENGINE', require( './helix/engine.fac.js' ) )
.factory( 'helix', require( './helix/helix.fac.js' ) )
.directive( 'poster', require( './helix/poster.dir.js' ) )

.config( [ '$stateProvider', '$urlRouterProvider', '$httpProvider',
function ( $stateProvider, $urlRouterProvider, $httpProvider ) {

	$urlRouterProvider.otherwise( '/' );

	$stateProvider
		.state( 'home', {
			url: '/',
			templateUrl: './template/home.html'
		} )
	;

} ] )

;
