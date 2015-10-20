angular.module( 'app', [
	'ui.router',
	'ngAnimate'
] )
.constant( 'ENDPOINT_URI', 'http://localhost:8001/' )
.constant( 'TMDB_API', {
	key: '374c0342a6406dfe0aeb3de2ea042c59',
	url: 'http://api.themoviedb.org/3/'
} )

.provider( 'log', require( './debug/log.pv.js' ) )

.factory( 'util', require( './util.js' ) )
.controller( 'mainCtrl', require( './main.ctrl.js' ) )
.factory( 'TMDb', require( './TMDb.fac.js' ) )
.factory( 'EVT', require( './events.fac.js' ) )
.controller( 'movieDetailCtrl', require( './movieDetail.ctrl.js' ) )
.directive( 'display', require( './helix/display.dir.js' ) )
.factory( 'ENGINE', require( './helix/engine.fac.js' ) )
.factory( 'helix', require( './helix/helix.fac.js' ) )
.directive( 'poster', require( './helix/poster.dir.js' ) )

.controller( 'signupCtrl', require( './auth/signup.ctrl.js' ) )
.controller( 'signinCtrl', require( './auth/signin.ctrl.js' ) )
.controller( 'signoutCtrl', require( './auth/signout.ctrl.js' ) )
.controller( 'privateCtrl', require( './auth/private.ctrl.js' ) )

.factory( 'auth', require( './auth/auth.fac.js' ) )
.factory( 'authToken', require( './auth/authToken.fac.js' ) )
.factory( 'authInterceptor', require( './auth/authInterceptor.fac.js' ) )

.config( [ '$stateProvider', '$urlRouterProvider', '$httpProvider',
function ( $stateProvider, $urlRouterProvider, $httpProvider ) {

	$urlRouterProvider.otherwise( '/' );

	$stateProvider
		.state( 'home', {
			url: '/',
			templateUrl: './template/home.html'
		} )
		.state( 'movieDetail', {
			url: '/movie/:movieId',
			templateUrl: './template/movie.html',
			controller: 'movieDetailCtrl',
			controllerAs: 'md',
			resolve: {
				movieItem: [ '$stateParams', 'TMDb', function ( $stateParams, TMDb ) {
					return TMDb.searchById( $stateParams.movieId );
				}]
			}
		} )
		.state( 'signup', {
			url: '/signup',
			templateUrl: './template/signup.html',
			controller: 'signupCtrl',
			controllerAs: 'signup'
		} )
		.state( 'signin', {
			url: '/signin',
			templateUrl: './template/signin.html',
			controller: 'signinCtrl',
			controllerAs: 'signin'
		} )
		.state( 'signout', {
			url: '/signout',
			controller: 'signoutCtrl'
		} )
		.state('private', {
			url: '/private',
			templateUrl: './template/private.html',
			controller: 'privateCtrl',
			controllerAs: 'private',
			resolve: {
				authorize: [ 'auth', function ( auth ) {
					return auth.authorize();
				} ]
			}
		})
	;

	$httpProvider.interceptors.push( 'authInterceptor' );

} ] )
.run( [ '$rootScope', '$state', 'auth', function ( $rootScope, $state, auth ) {

	// todo authorize user every beginning of session
	// or just check if hasToken?
	auth.authorize( true );

	$rootScope.$on( '$stateChangeError', function ( event, toState, toParams, fromState, fromParams, error ) {

		event.preventDefault(); // prevent transition
		console.log( error );
		if ( error ) {
			$state.go( 'signin' );
		}

	} );

} ] )
.config( [ 'logProvider', '$httpProvider', function ( logProvider, $httpProvider ) {

	logProvider.enableDebug();
	logProvider.enableDebugNamespace( 'info', 'err' ); // ctrl

	$httpProvider.useLegacyPromiseExtensions( false );

} ] )
;
