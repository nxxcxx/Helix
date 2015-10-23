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

.factory( 'auth', require( './auth/auth.fac.js' ) )
.factory( 'authToken', require( './auth/authToken.fac.js' ) )
.factory( 'authInterceptor', require( './auth/authInterceptor.fac.js' ) )

.controller( 'movieCollectionCtrl', require( './auth/movieCollection.ctrl.js' ) )
.factory( 'movieCollection', require( './movieCollection.fac.js' ) )
.directive( 'collectionModal', require( './collectionModal.dir.js' ) )
.factory( 'collectionModalService', require( './collectionModalService.fac.js' ) )
.directive( 'collectionItem', require( './collectionItem.dir.js' ) )

.config( [ '$stateProvider', '$urlRouterProvider', '$httpProvider',
function ( $stateProvider, $urlRouterProvider, $httpProvider ) {

	$urlRouterProvider.otherwise( '/' );

	$stateProvider
		.state( 'helix', {
			url: '/',
			templateUrl: './template/helix.html'
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
		.state('collection', {
			url: '/collection',
			templateUrl: './template/collection.html',
			controller: 'movieCollectionCtrl',
			controllerAs: 'mc',
			resolve: {
				authorize: [ 'auth', function ( auth ) {
					return auth.authorize();
				} ],
				resolvedCollection: [ 'movieCollection', function ( movieCollection ) {
					return movieCollection.resolveCollection();
				} ]
			}
		})
	;

	$httpProvider.interceptors.push( 'authInterceptor' );

} ] )
.run( [ 'log', '$rootScope', '$state', 'auth', 'movieCollection', function ( log, $rootScope, $state, auth, movieCollection ) {

	// todo authorize user every beginning of session
	// todo dont autorize twice
	auth.authorize( true );

	movieCollection.resolveCollection();

	$rootScope.$on( '$stateChangeError', function ( event, toState, toParams, fromState, fromParams, error ) {

		event.preventDefault(); // prevent transition
		log.debug( 'warn', error );
		if ( error ) {
			$state.go( 'signin' );
		}

	} );

} ] )
.config( [ 'logProvider', '$httpProvider', function ( logProvider, $httpProvider ) {

	logProvider.enableDebug();
	logProvider.enableDebugNamespace( 'info', 'err', 'auth' ); // ctrl

	$httpProvider.useLegacyPromiseExtensions( false );

} ] )
;
