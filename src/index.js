angular.module( 'app', [
	'ui.router',
	'ngAnimate'
] )
.constant( 'ENDPOINT_URI', 'http://localhost:8001/' )
.constant( 'TMDB_API', {
	key: '374c0342a6406dfe0aeb3de2ea042c59',
	url: 'http://api.themoviedb.org/3/'
} )

.provider( 'log', require( './common/log.pv.js' ) )
.factory( 'util', require( './common/util.js' ) )
.factory( 'EVT', require( './common/events.fac.js' ) )

.factory( 'TMDb', require( './API/TMDb.fac.js' ) )

.controller( 'mainCtrl', require( './main.ctrl.js' ) )
.factory( 'ENGINE', require( './helix/engine.fac.js' ) )
.factory( 'helix', require( './helix/helix.fac.js' ) )
.directive( 'display', require( './helix/display.dir.js' ) )
.directive( 'poster', require( './helix/poster.dir.js' ) )

.controller( 'movieDetailCtrl', require( './movieDetail.ctrl.js' ) )

.factory( 'auth', require( './auth/auth.fac.js' ) )
.factory( 'authToken', require( './auth/authToken.fac.js' ) )
.factory( 'authInterceptor', require( './auth/authInterceptor.fac.js' ) )
.controller( 'signupCtrl', require( './auth/signup.ctrl.js' ) )
.controller( 'signinCtrl', require( './auth/signin.ctrl.js' ) )
.controller( 'signoutCtrl', require( './auth/signout.ctrl.js' ) )

.controller( 'movieCollectionCtrl', require( './movieCollection/movieCollection.ctrl.js' ) )
.factory( 'movieCollection', require( './movieCollection/movieCollection.fac.js' ) )
.factory( 'collectionModalService', require( './movieCollection/collectionModalService.fac.js' ) )
.directive( 'collectionModal', require( './movieCollection/collectionModal.dir.js' ) )
.directive( 'collectionItem', require( './movieCollection/collectionItem.dir.js' ) )
.controller( 'collectionSettings', require( './movieCollection/collectionSettings.ctrl.js' ) )

.directive( 'hoverClass', require( './directive/hoverClass.dir.js' ) )

.config( require( './config/routeConfig.js' ) )
.config( require( './config/logConfig.js' ) )
.config( require( './config/httpConfig.js' ) )
.run( [ 'log', '$rootScope', '$state', 'auth', 'movieCollection', function ( log, $rootScope, $state, auth, movieCollection ) {

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
;
